/**
 * WebSocket 路由 /ws — 连接生命周期与事件协议入口。
 * docs/implementation-plan.md 第 7 节：
 * - 升级时校验 Origin 与会话 Cookie；
 * - open 后等待客户端 session.resume 才订阅与同步；
 * - 所有事件先运行时校验，再进入业务（无 await 的同步临界区）；
 * - 心跳活性由客户端 ping 驱动，服务端在插件中清理长期静默的连接。
 */
import type { Hooks, Peer } from "crossws";
import type { GuestRecord } from "../stores/memory";
import type { WsServerEvent } from "#shared/types/protocol";
import {
  broadcastToRoom,
  computePresence,
  registerConnection,
  sendToConnection,
  unregisterConnection,
} from "../utils/connections";
import { resolveCapabilities } from "../utils/env";
import { getSessionGuestFromCookieHeader } from "../utils/session";
import {
  parseClientEvent,
  validateMessageSendPayload,
  validatePingPayload,
  validateResumePayload,
  validateRoomReadPayload,
  ValidationError,
} from "../utils/validate";
import { sendMessage, markRead } from "../services/message-service";
import { memberKey, useMemory } from "../stores/memory";
import { isAllowedUpgrade } from "../utils/http";
import { WS_SERVER_MESSAGE_OVERHEAD_BYTES } from "#shared/constants/limits";

const capabilities = resolveCapabilities();

function send(peer: Peer, event: WsServerEvent) {
  try {
    peer.send(JSON.stringify(event));
  } catch {
    // 连接可能正在关闭；由心跳与 close 生命周期处理
  }
}

function fail(
  peer: Peer,
  code: string,
  message: string,
  requestId?: string,
  roomId?: string,
) {
  send(peer, {
    v: 1,
    type: "error",
    ...(roomId ? { roomId } : {}),
    payload: { code: code as never, message, requestId },
  });
}

function readGuest(peer: Peer): GuestRecord | undefined {
  const headers = peer.request.headers;
  return getSessionGuestFromCookieHeader(headers.get("cookie") ?? undefined);
}

/** 订阅该访客已加入的全部房间（成员关系为准） */
function subscribedRooms(guestId: string): string[] {
  const state = useMemory();
  const rooms: string[] = [];
  for (const [roomId, memberIds] of state.roomMemberIds) {
    if (
      memberIds.has(guestId) &&
      state.members.has(memberKey(roomId, guestId))
    ) {
      rooms.push(roomId);
    }
  }
  return rooms;
}

export default defineWebSocketHandler({
  upgrade(request) {
    const cookie = request.headers.get("cookie");
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    // 浏览器升级请求总是携带 Origin；拒绝缺失或跨源的升级
    if (!isAllowedUpgrade(cookie, origin, host)) {
      throw new Response("Forbidden", { status: 403 });
    }
    if (!getSessionGuestFromCookieHeader(cookie ?? undefined)) {
      throw new Response("Unauthorized", { status: 401 });
    }
  },

  open(peer) {
    const state = useMemory();
    const guest = readGuest(peer);
    if (!guest) {
      peer.close(4001, "unauthenticated");
      return;
    }
    if (state.connections.size >= state.limits.maxConnections) {
      send(peer, {
        v: 1,
        type: "error",
        payload: { code: "SERVER_FULL", message: "当前连接数已满，请稍后再试" },
      });
      peer.close(1013, "server-full");
      return;
    }
    registerConnection({
      id: peer.id,
      guestId: guest.id,
      rooms: new Set(),
      lastSeenAt: Date.now(),
      connectedAt: Date.now(),
      send: (text) => peer.send(text),
      close: (code, reason) => peer.close(code, reason),
    });
  },

  message(peer, message) {
    const state = useMemory();
    const connection = state.connections.get(peer.id);
    if (!connection) {
      peer.close(4001, "unauthenticated");
      return;
    }
    connection.lastSeenAt = Date.now();
    const requestId = (envelope?: { requestId?: string }) =>
      envelope?.requestId;

    // 事件解析成功后记录目标房间，供 catch 阶段回填错误信封
    let activeRoomId: string | undefined;
    let activeRequestId: string | undefined;
    try {
      // Node 适配器（ws）把文本帧交付为 Buffer；仅接受 UTF-8 文本事件
      const raw =
        typeof message.rawData === "string"
          ? message.rawData
          : Buffer.isBuffer(message.rawData)
            ? message.rawData.toString("utf8")
            : Array.isArray(message.rawData) ||
                message.rawData instanceof Uint8Array
              ? Buffer.from(message.rawData).toString("utf8")
              : undefined;
      if (typeof raw !== "string") {
        fail(peer, "BAD_REQUEST", "不支持的消息格式", undefined);
        return;
      }
      const parsed = parseClientEvent(raw, capabilities.maxWsMessageBytes);
      activeRoomId = parsed.envelope.roomId;
      activeRequestId = parsed.envelope.requestId;
      const guest = readGuest(peer);
      if (!guest) {
        fail(
          peer,
          "UNAUTHENTICATED",
          "身份已失效，请重新加入",
          requestId(parsed.envelope),
        );
        peer.close(4001, "unauthenticated");
        return;
      }

      switch (parsed.envelope.type) {
        case "ping": {
          const payload = validatePingPayload(parsed.payload);
          send(peer, { v: 1, type: "pong", payload: { t: payload.t } });
          break;
        }
        case "session.resume": {
          validateResumePayload(parsed.payload);
          // 先订阅，再取同步边界，保证边界与订阅之间不遗漏消息
          const rooms = subscribedRooms(guest.id);
          const newlySubscribed: string[] = [];
          for (const roomId of rooms) {
            if (!connection.rooms.has(roomId)) {
              connection.rooms.add(roomId);
              newlySubscribed.push(roomId);
            }
          }
          // 新订阅的房间向既有连接播报在线状态
          for (const roomId of newlySubscribed) {
            broadcastToRoom(roomId, {
              v: 1,
              type: "presence.updated",
              roomId,
              payload: { roomId, members: computePresence(roomId) },
            });
          }
          const syncStates = rooms.map((roomId) => {
            const room = state.rooms.get(roomId)!;
            const member = state.members.get(memberKey(roomId, guest.id))!;
            return {
              room: {
                id: room.id,
                name: room.name,
                createdBy: room.createdBy,
                createdAt: room.createdAt,
                isDefault: room.isDefault,
              },
              boundarySeq: room.nextSeq - 1,
              lastReadSeq: member.lastReadSeq,
              memberCount: state.roomMemberIds.get(roomId)?.size ?? 0,
            };
          });
          send(peer, {
            v: 1,
            type: "session.ready",
            payload: {
              serverInstanceId: state.serverInstanceId,
              capabilities: {
                ...capabilities,
                serverInstanceId: state.serverInstanceId,
              },
              rooms: syncStates,
            },
          });
          break;
        }
        case "message.send": {
          const roomId = parsed.envelope.roomId;
          if (!roomId) {
            fail(
              peer,
              "BAD_REQUEST",
              "缺少目标房间",
              requestId(parsed.envelope),
            );
            break;
          }
          const payload = validateMessageSendPayload(parsed.payload);
          if (
            parsed.byteLength + WS_SERVER_MESSAGE_OVERHEAD_BYTES >
            capabilities.maxWsMessageBytes
          ) {
            throw new ValidationError(
              "MESSAGE_TOO_LARGE",
              "消息内容过长，请缩短后发送",
            );
          }
          const result = sendMessage(guest, roomId, payload);
          // 显式确认发送端；广播已覆盖同一访客的其他连接
          send(peer, {
            v: 1,
            type: "message.ack",
            requestId: parsed.envelope.requestId,
            roomId,
            payload: {
              clientMessageId: payload.clientMessageId,
              message: result.view,
            },
          });
          break;
        }
        case "room.read": {
          const roomId = parsed.envelope.roomId;
          if (!roomId) {
            fail(
              peer,
              "BAD_REQUEST",
              "缺少目标房间",
              requestId(parsed.envelope),
            );
            break;
          }
          const payload = validateRoomReadPayload(parsed.payload);
          markRead(guest, roomId, payload.seq);
          break;
        }
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        fail(peer, error.code, error.message, activeRequestId, activeRoomId);
      } else {
        console.error("[ws] 事件处理失败", error);
        fail(
          peer,
          "INTERNAL",
          "服务出现错误，请稍后重试",
          activeRequestId,
          activeRoomId,
        );
      }
    }
  },

  close(peer) {
    const state = useMemory();
    const connection = state.connections.get(peer.id);
    const guestId = connection?.guestId;
    const rooms = unregisterConnection(peer.id);
    if (!guestId) return;
    // 通知相关房间在线状态变化
    for (const roomId of rooms) {
      if (state.rooms.has(roomId)) {
        broadcastToRoom(roomId, {
          v: 1,
          type: "presence.updated",
          roomId,
          payload: { roomId, members: computePresence(roomId) },
        });
      }
    }
  },

  error(peer, error) {
    console.error("[ws] 连接错误", peer.id, error?.message);
  },
});
