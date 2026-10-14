/**
 * HTTP 接口 DTO（docs/implementation-plan.md 8.2 节）。
 * 请求体在服务端逐字段校验；错误统一为 { code, message }。
 */
import type {
  AttachmentPublic,
  GuestPublic,
  MemberPublic,
  MessageView,
  RoomPublic,
  RoomSummary,
} from "./entities";
import type { ServerCapabilities } from "./protocol";

// ---------- 会话 ----------

export interface CreateSessionBody {
  nickname: string;
}

export interface SessionView {
  guest: GuestPublic;
  serverInstanceId: string;
}

export interface UpdateProfileBody {
  nickname: string;
}

// ---------- 房间 ----------

export interface CreateRoomBody {
  name: string;
}

export interface RoomListResponse {
  serverInstanceId: string;
  rooms: RoomSummary[];
}

export interface JoinRoomResponse {
  room: RoomPublic;
  members: MemberPublic[];
}

export interface RoomMembersResponse {
  room: RoomPublic;
  members: MemberPublic[];
}

// ---------- 历史分页 ----------

export interface RoomMessagesQuery {
  /** 取 seq 小于该值的更早消息（向上翻页） */
  beforeSeq?: number;
  /** 取 seq 大于该值的新消息（断线补齐） */
  afterSeq?: number;
  /** 与 afterSeq 配合的上界（含），避免越过同步边界 */
  throughSeq?: number;
  limit?: number;
}

export interface RoomMessagesResponse {
  messages: MessageView[];
  /** 还有更早消息时给出下一页游标 */
  hasMoreBefore: boolean;
  /** afterSeq 分页仍有后续时给出 */
  hasMoreAfter: boolean;
  /** 房间当前最大 seq；空房间为 0 */
  latestSeq: number;
}

// ---------- 附件 ----------

export interface AttachmentUploadResponse {
  attachment: AttachmentPublic;
}

// ---------- 能力与健康 ----------

export interface CapabilitiesResponse extends ServerCapabilities {
  /** 已加入房间的消息总量等不在此暴露；仅部署核实所需参数 */
  maxConnections: number;
}

export interface HealthResponse {
  ok: boolean;
  serverInstanceId: string;
}

// ---------- 错误 ----------

export interface ApiErrorBody {
  code: string;
  message: string;
}
