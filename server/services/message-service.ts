/**
 * 消息业务：发送（幂等 + 临界区内分配 seq）、分页查询、阅读进度。
 * docs/implementation-plan.md 7.3/7.4/8.2 节。
 */
import type { GuestRecord } from "../stores/memory";
import type { MessageView, StoredMessage } from "#shared/types/entities";
import type { MessageSendPayload } from "#shared/types/protocol";
import type { RoomMessagesQuery } from "#shared/types/api";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_HISTORY_RESPONSE_BYTES,
  MAX_PAGE_LIMIT,
  RATE_MESSAGE_SEND,
  RATE_ROOM_READ,
} from "#shared/constants/limits";
import { ValidationError } from "../utils/validate";
import { toMessageView } from "../utils/dto";
import { broadcastToGuest, broadcastToRoom } from "../utils/connections";
import { consumeRate } from "../utils/ratelimit";
import { idempotencyKey, memberKey, useMemory } from "../stores/memory";
import { PREVIEW_IMAGE_MIMES } from "#shared/constants/mime";

/** V8 字符串按 UTF-16 计费，再计入 JSON 消息的固定字段开销。 */
function estimateMessageStorageBytes(message: StoredMessage): number {
  const { text, ...metadata } = message;
  const metadataBytes = Math.max(
    1024,
    Buffer.byteLength(JSON.stringify(metadata), "utf8"),
  );
  return (text ? text.length * 2 : 0) + metadataBytes;
}

/** 以最坏 JSON 转义长度估算分页响应，避免多条长消息组成超大响应。 */
function estimateHistoryViewBytes(message: StoredMessage): number {
  return 4096 + (message.text ? message.text.length * 6 : 0);
}

function getRoom(roomId: string) {
  const room = useMemory().rooms.get(roomId);
  if (!room)
    throw new ValidationError("ROOM_NOT_FOUND", "房间不存在或已被清除");
  return room;
}

function requireMember(roomId: string, guestId: string) {
  const member = useMemory().members.get(memberKey(roomId, guestId));
  if (!member) throw new ValidationError("FORBIDDEN", "你尚未加入这个房间");
  return member;
}

export interface SendMessageResult {
  view: MessageView;
  /** 命中幂等索引返回的历史消息 */
  duplicate: boolean;
}

/**
 * 发送消息。校验之后到广播之前的全部内存写入都在同一个同步临界区内
 * （本函数不含 await），Node 单线程执行保证 seq 与幂等索引一致。
 */
export function sendMessage(
  guest: GuestRecord,
  roomId: string,
  payload: MessageSendPayload,
): SendMessageResult {
  const state = useMemory();
  const room = getRoom(roomId);
  requireMember(roomId, guest.id);
  if (
    !consumeRate(
      "send",
      guest.id,
      RATE_MESSAGE_SEND.capacity,
      RATE_MESSAGE_SEND.refillPerSecond,
    )
  ) {
    throw new ValidationError("RATE_LIMITED", "操作过于频繁，请稍后再试");
  }

  // 幂等：同一 (senderId, clientMessageId) 重复请求返回原消息
  const key = idempotencyKey(guest.id, payload.clientMessageId);
  const existing = state.idempotency.get(key);
  if (existing) {
    const samePayload =
      existing.roomId === roomId &&
      existing.kind === payload.kind &&
      (payload.kind === "text"
        ? existing.text === payload.text
        : existing.attachmentId === payload.attachmentId);
    if (!samePayload) {
      throw new ValidationError(
        "MESSAGE_INVALID",
        "消息标识已用于其他内容，请重新发送",
      );
    }
    return { view: toMessageView(existing), duplicate: true };
  }

  let attachmentId: string | undefined;
  if (payload.kind !== "text") {
    const attachment = payload.attachmentId
      ? state.attachments.get(payload.attachmentId)
      : undefined;
    if (!attachment) {
      throw new ValidationError(
        "ATTACHMENT_NOT_FOUND",
        "文件已被清除或不可访问",
      );
    }
    if (attachment.roomId !== roomId) {
      throw new ValidationError("FORBIDDEN", "文件不属于这个房间");
    }
    if (attachment.ownerId !== guest.id) {
      throw new ValidationError("FORBIDDEN", "只能发送自己上传的文件");
    }
    if (
      payload.kind === "image" &&
      !(PREVIEW_IMAGE_MIMES as readonly string[]).includes(attachment.mime)
    ) {
      throw new ValidationError(
        "MESSAGE_INVALID",
        "该文件不能作为图片预览，请按文件发送",
      );
    }
    attachmentId = attachment.id;
  }

  const messages = state.messages.get(roomId);
  if (!messages)
    throw new ValidationError("ROOM_NOT_FOUND", "房间不存在或已被清除");
  if (messages.length >= state.limits.maxMessagesPerRoom) {
    throw new ValidationError(
      "MESSAGE_CAPACITY_EXCEEDED",
      "房间消息已达上限，请联系服务启动者",
    );
  }

  // ---- 同步临界区：分配 seq、保存、建索引 ----
  const now = new Date().toISOString();
  const seq = room.nextSeq;
  const message: StoredMessage = {
    id: crypto.randomUUID(),
    clientMessageId: payload.clientMessageId,
    roomId,
    seq,
    senderId: guest.id,
    kind: payload.kind,
    ...(payload.kind === "text" ? { text: payload.text } : { attachmentId }),
    createdAt: now,
  };
  const storageBytes = estimateMessageStorageBytes(message);
  if (
    state.storedMessageBytes + storageBytes >
    state.limits.maxTotalMessageBytes
  ) {
    throw new ValidationError(
      "MESSAGE_CAPACITY_EXCEEDED",
      "服务消息容量已满，请联系服务启动者",
    );
  }
  room.nextSeq++;
  messages.push(message);
  state.messageIndex.set(message.id, message);
  state.messageStorageBytes.set(message.id, storageBytes);
  state.storedMessageBytes += storageBytes;
  state.idempotency.set(key, message);
  if (attachmentId) {
    const attachment = state.attachments.get(attachmentId);
    if (attachment) attachment.referenced = true;
  }
  // ---- 临界区结束 ----

  const view = toMessageView(message);
  broadcastToRoom(roomId, {
    v: 1,
    type: "message.created",
    roomId,
    payload: { message: view },
  });
  return { view, duplicate: false };
}

export function markRead(guest: GuestRecord, roomId: string, seq: number) {
  const state = useMemory();
  const room = getRoom(roomId);
  const member = requireMember(roomId, guest.id);
  if (
    !consumeRate(
      "read",
      guest.id,
      RATE_ROOM_READ.capacity,
      RATE_ROOM_READ.refillPerSecond,
    )
  ) {
    throw new ValidationError("RATE_LIMITED", "操作过于频繁，请稍后再试");
  }
  // 阅读进度只前进，且不能越过房间当前最大序号
  const maxSeq = room.nextSeq - 1;
  const next = Math.min(seq, maxSeq);
  if (next > member.lastReadSeq) {
    member.lastReadSeq = next;
    broadcastToGuest(guest.id, {
      v: 1,
      type: "room.read.updated",
      roomId,
      payload: { roomId, guestId: guest.id, lastReadSeq: member.lastReadSeq },
    });
  }
}

function paginateHistory(roomId: string, query: RoomMessagesQuery) {
  const state = useMemory();
  const messages = state.messages.get(roomId) ?? [];
  const limit = Math.max(
    1,
    Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT),
  );
  const latestSeq = messages.at(-1)?.seq ?? 0;

  if (query.afterSeq !== undefined) {
    const upper = Math.min(
      query.throughSeq ?? Number.MAX_SAFE_INTEGER,
      latestSeq,
    );
    const start = Math.max(0, query.afterSeq);
    const page: StoredMessage[] = [];
    let responseBytes = 0;
    for (const message of messages) {
      if (message.seq <= start) continue;
      if (message.seq > upper) break;
      const cost = estimateHistoryViewBytes(message);
      if (page.length > 0 && responseBytes + cost > MAX_HISTORY_RESPONSE_BYTES)
        break;
      page.push(message);
      responseBytes += cost;
      if (page.length >= limit) break;
    }
    const lastSeq = page.at(-1)?.seq;
    const hasMoreAfter =
      lastSeq !== undefined &&
      messages.some((m) => m.seq > lastSeq && m.seq <= upper);
    return { messages: page, hasMoreAfter, hasMoreBefore: false, latestSeq };
  }

  const before = Math.min(
    query.beforeSeq ?? Number.MAX_SAFE_INTEGER,
    latestSeq + 1,
  );
  const page: StoredMessage[] = [];
  let responseBytes = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.seq >= before) continue;
    const cost = estimateHistoryViewBytes(message);
    if (page.length > 0 && responseBytes + cost > MAX_HISTORY_RESPONSE_BYTES)
      break;
    page.unshift(message);
    responseBytes += cost;
    if (page.length >= limit) break;
  }
  const firstSeq = page[0]?.seq;
  const hasMoreBefore =
    firstSeq !== undefined && messages.some((m) => m.seq < firstSeq);
  return { messages: page, hasMoreBefore, hasMoreAfter: false, latestSeq };
}

export function getRoomMessages(
  selfId: string,
  roomId: string,
  query: RoomMessagesQuery,
) {
  requireMember(roomId, selfId);
  const page = paginateHistory(roomId, query);
  return {
    messages: page.messages.map(toMessageView),
    hasMoreBefore: page.hasMoreBefore,
    hasMoreAfter: page.hasMoreAfter,
    latestSeq: page.latestSeq,
  };
}

/** 断线补齐与首次同步共用的边界查询：返回 (afterSeq, throughSeq] 的消息 */
export function getMessagesRange(
  selfId: string,
  roomId: string,
  afterSeq: number,
  throughSeq: number,
) {
  requireMember(roomId, selfId);
  return paginateHistory(roomId, { afterSeq, throughSeq });
}
