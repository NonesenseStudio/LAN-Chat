/**
 * 网络数据运行时校验。静态类型不能校验网络输入：HTTP 请求体与
 * WebSocket 事件在进入业务前逐字段验证（docs/implementation-plan.md 6.1/7 节）。
 */
import {
  NICKNAME_MAX_LENGTH,
  ROOM_NAME_MAX_LENGTH,
} from "#shared/constants/limits";
import { AVATAR_ICON_OPTIONS, type AvatarIcon } from "#shared/constants/avatar";
import type { EventEnvelope } from "#shared/types/protocol";
import type { WsClientEventMap } from "#shared/types/protocol";

export class ValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ValidationError("BAD_REQUEST", "请求包含不支持的字段");
  }
}

function boundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  const result = asString(value, field);
  if (result.length > maxLength)
    throw new ValidationError("BAD_REQUEST", `请求字段 ${field} 无效`);
  return result;
}

export function validateNickname(input: unknown): string {
  if (typeof input !== "string")
    throw new ValidationError("BAD_REQUEST", "请输入昵称");
  const nickname = input.trim();
  if (nickname.length === 0)
    throw new ValidationError("BAD_REQUEST", "昵称不能为空");
  if (nickname.length > NICKNAME_MAX_LENGTH) {
    throw new ValidationError(
      "BAD_REQUEST",
      `昵称不能超过 ${NICKNAME_MAX_LENGTH} 个字符`,
    );
  }
  return nickname;
}

export function validateAvatarIcon(input: unknown): AvatarIcon {
  if (
    typeof input !== "string" ||
    !AVATAR_ICON_OPTIONS.some((option) => option.value === input)
  ) {
    throw new ValidationError("BAD_REQUEST", "头像图标无效");
  }
  return input as AvatarIcon;
}

export function validateRoomName(input: unknown): string {
  if (typeof input !== "string")
    throw new ValidationError("BAD_REQUEST", "请输入房间名");
  const name = input.trim();
  if (name.length === 0)
    throw new ValidationError("BAD_REQUEST", "房间名不能为空");
  if (name.length > ROOM_NAME_MAX_LENGTH) {
    throw new ValidationError(
      "BAD_REQUEST",
      `房间名不能超过 ${ROOM_NAME_MAX_LENGTH} 个字符`,
    );
  }
  return name;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError("BAD_REQUEST", `请求缺少 ${field}`);
  }
  return value;
}

/** 解析并校验客户端 WebSocket 事件；返回带类型的事件或 undefined（静默忽略） */
export function parseClientEvent(
  raw: string,
  maxBytes: number,
): { envelope: EventEnvelope; payload: unknown; byteLength: number } {
  // 解析前按原始载荷字节长度检查（UTF-8 字节，不是字符串 .length）
  const byteLength = Buffer.byteLength(raw, "utf8");
  if (byteLength > maxBytes) {
    throw new ValidationError(
      "MESSAGE_TOO_LARGE",
      "消息内容过长，请缩短后发送",
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ValidationError("BAD_REQUEST", "事件格式无效");
  }
  if (!isPlainObject(data))
    throw new ValidationError("BAD_REQUEST", "事件格式无效");
  assertOnlyKeys(data, ["v", "type", "requestId", "roomId", "payload"]);
  if (data.v !== 1)
    throw new ValidationError("BAD_REQUEST", "不支持的协议版本");
  const type = asString(data.type, "type");
  if (!["session.resume", "message.send", "room.read", "ping"].includes(type)) {
    throw new ValidationError("BAD_REQUEST", "未知的事件类型");
  }
  const envelope: EventEnvelope = {
    v: 1,
    type: type as EventEnvelope["type"],
    requestId:
      data.requestId === undefined
        ? undefined
        : boundedString(data.requestId, "requestId", 64),
    roomId:
      data.roomId === undefined
        ? undefined
        : boundedString(data.roomId, "roomId", 64),
  };
  return { envelope, payload: data.payload, byteLength };
}

export function validateResumePayload(
  payload: unknown,
): WsClientEventMap["session.resume"] {
  if (!isPlainObject(payload) || !Array.isArray(payload.rooms)) {
    throw new ValidationError("BAD_REQUEST", "恢复请求无效");
  }
  assertOnlyKeys(payload, ["rooms"]);
  if (payload.rooms.length > 500)
    throw new ValidationError("BAD_REQUEST", "恢复请求房间过多");
  const rooms = payload.rooms.map((item) => {
    if (!isPlainObject(item))
      throw new ValidationError("BAD_REQUEST", "恢复请求无效");
    assertOnlyKeys(item, ["roomId", "lastSeq"]);
    if (
      typeof item.lastSeq !== "number" ||
      !Number.isSafeInteger(item.lastSeq) ||
      item.lastSeq < 0
    ) {
      throw new ValidationError("BAD_REQUEST", "恢复请求无效");
    }
    return {
      roomId: boundedString(item.roomId, "roomId", 64),
      lastSeq: item.lastSeq,
    };
  });
  return { rooms };
}

export function validateMessageSendPayload(
  payload: unknown,
): WsClientEventMap["message.send"] {
  if (!isPlainObject(payload))
    throw new ValidationError("MESSAGE_INVALID", "消息内容无效，请修改后发送");
  const clientMessageId = boundedString(
    payload.clientMessageId,
    "clientMessageId",
    64,
  );
  const kind = payload.kind;
  if (kind === "text") {
    assertOnlyKeys(payload, ["clientMessageId", "kind", "text"]);
    const text = payload.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new ValidationError(
        "MESSAGE_INVALID",
        "消息内容无效，请修改后发送",
      );
    }
    return { clientMessageId, kind: "text", text };
  }
  if (kind === "image" || kind === "file") {
    assertOnlyKeys(payload, ["clientMessageId", "kind", "attachmentId"]);
    const attachmentId = boundedString(
      payload.attachmentId,
      "attachmentId",
      64,
    );
    return { clientMessageId, kind, attachmentId };
  }
  throw new ValidationError("MESSAGE_INVALID", "消息内容无效，请修改后发送");
}

export function validateRoomReadPayload(
  payload: unknown,
): WsClientEventMap["room.read"] {
  if (!isPlainObject(payload))
    throw new ValidationError("BAD_REQUEST", "阅读进度无效");
  assertOnlyKeys(payload, ["seq"]);
  const seq = payload.seq;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
    throw new ValidationError("BAD_REQUEST", "阅读进度无效");
  }
  return { seq };
}

export function validatePingPayload(
  payload: unknown,
): WsClientEventMap["ping"] {
  if (!isPlainObject(payload))
    throw new ValidationError("BAD_REQUEST", "心跳请求无效");
  assertOnlyKeys(payload, ["t"]);
  if (payload.t === undefined) return {};
  if (typeof payload.t !== "number" || !Number.isFinite(payload.t)) {
    throw new ValidationError("BAD_REQUEST", "心跳请求无效");
  }
  return { t: payload.t };
}
