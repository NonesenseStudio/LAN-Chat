/**
 * WebSocket 事件协议（docs/implementation-plan.md 第 7 节）。
 * 事件定义为可辨识联合：每个事件类型对应确定的 payload 必填字段。
 * 运行时校验在 server/utils/validate.ts 中逐一实现，静态类型不能替代网络数据校验。
 */
import type {
  AttachmentPublic,
  GuestPublic,
  MessageView,
  RoomPublic,
} from "./entities";

export interface EventEnvelope {
  v: 1;
  type: WsClientEventType | WsServerEventType;
  /** 请求关联 ID；message.send 必带，错误与确认按其回传 */
  requestId?: string;
  /** room.read / message.send 指定的目标房间 */
  roomId?: string;
}

/** 客户端 → 服务端事件 */
export type WsClientEventType =
  "session.resume" | "message.send" | "room.read" | "ping";

/** 服务端 → 客户端事件 */
export type WsServerEventType =
  | "session.ready"
  | "message.ack"
  | "message.created"
  | "room.read.updated"
  | "room.updated"
  | "presence.updated"
  | "pong"
  | "error";

/** 部署能力参数，数值由服务端按实际链路核实后发布（7.5 节） */
export interface ServerCapabilities {
  /** 有效 WebSocket 消息字节上限（UTF-8 字节，含协议元数据） */
  maxWsMessageBytes: number;
  /** 单附件字节上限（HTTP multipart 总请求体上限，含表单开销） */
  maxAttachmentBytes: number;
  /** 本进程附件总内存上限 */
  maxTotalAttachmentBytes: number;
  serverInstanceId: string;
}

/** session.resume 携带的房间同步进度 */
export interface RoomResumeState {
  roomId: string;
  /** 该房间最后连续同步到的序号；首次为 0 */
  lastSeq: number;
}

/** session.ready 中的房间同步边界 */
export interface RoomSyncState {
  room: RoomPublic;
  /** 订阅建立时的同步边界 H = 当前最大 seq；客户端对 ≤ H 的部分分页补拉 */
  boundarySeq: number;
  lastReadSeq: number;
  memberCount: number;
}

export interface SessionResumePayload {
  rooms: RoomResumeState[];
}

export interface SessionReadyPayload {
  serverInstanceId: string;
  capabilities: ServerCapabilities;
  rooms: RoomSyncState[];
}

export type MessageKind = "text" | "image" | "file";

export interface MessageSendPayload {
  clientMessageId: string;
  kind: MessageKind;
  /** kind=text 时必填 */
  text?: string;
  /** kind=image|file 时必填，须为已上传成功的附件 */
  attachmentId?: string;
}

export interface MessageAckPayload {
  clientMessageId: string;
  message: MessageView;
}

export interface MessageCreatedPayload {
  message: MessageView;
}

export interface RoomReadPayload {
  /** 提交阅读到的消息序号；只允许前进 */
  seq: number;
}

export interface RoomReadUpdatedPayload {
  roomId: string;
  guestId: string;
  lastReadSeq: number;
}

export type RoomUpdateReason =
  "created" | "member_joined" | "member_left" | "profile" | "removed";

export interface RoomUpdatedPayload {
  roomId: string;
  room: RoomPublic;
  reason: RoomUpdateReason;
  /** member_* 事件涉及的成员；profile 事件为改资料的访客 */
  guest?: GuestPublic;
  /** reason=member_joined/member_left 时为当前成员快照 */
  members?: MemberPublic[];
}

export interface PresenceMemberState {
  guestId: string;
  onlineCount: number;
}

export interface PresenceUpdatedPayload {
  roomId: string;
  members: PresenceMemberState[];
}

export interface PongPayload {
  /** 回传客户端 ping 携带的时间戳 */
  t?: number;
}

export type WsErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "ROOM_NOT_FOUND"
  | "MESSAGE_TOO_LARGE"
  | "MESSAGE_INVALID"
  | "ATTACHMENT_NOT_FOUND"
  | "MESSAGE_CAPACITY_EXCEEDED"
  | "ROOM_CAPACITY_EXCEEDED"
  | "MEMBER_CAPACITY_EXCEEDED"
  | "GUEST_CAPACITY_EXCEEDED"
  | "RATE_LIMITED"
  | "SERVER_FULL"
  | "INTERNAL";

export interface ErrorPayload {
  code: WsErrorCode;
  /** 面向用户的中文说明 */
  message: string;
  requestId?: string;
}

/** 服务端 → 客户端事件集合 */
export interface WsServerEventMap {
  "session.ready": SessionReadyPayload;
  "message.ack": MessageAckPayload;
  "message.created": MessageCreatedPayload;
  "room.read.updated": RoomReadUpdatedPayload;
  "room.updated": RoomUpdatedPayload;
  "presence.updated": PresenceUpdatedPayload;
  pong: PongPayload;
  error: ErrorPayload;
}

/** 客户端 → 服务端事件集合 */
export interface WsClientEventMap {
  "session.resume": SessionResumePayload;
  "message.send": MessageSendPayload;
  "room.read": RoomReadPayload;
  ping: { t?: number };
}

export type WsClientEvent = {
  [K in keyof WsClientEventMap]: {
    v: 1;
    type: K;
    requestId?: string;
    roomId?: string;
    payload: WsClientEventMap[K];
  };
}[keyof WsClientEventMap];

export type WsServerEvent = {
  [K in keyof WsServerEventMap]: {
    v: 1;
    type: K;
    requestId?: string;
    roomId?: string;
    payload: WsServerEventMap[K];
  };
}[keyof WsServerEventMap];

/** 客户端连接状态机（7.1 节） */
export type ChatSocketStatus =
  "idle" | "connecting" | "connected" | "reconnecting" | "needs_rejoin";
