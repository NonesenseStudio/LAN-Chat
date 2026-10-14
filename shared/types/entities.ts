/**
 * 实体定义。服务端内存是唯一权威来源；字段与 docs/implementation-plan.md 8.1 对应。
 * 这些类型同时用于服务端与客户端，只描述已验证后的数据形态。
 */
import type { AvatarIcon } from "../constants/avatar";

/** 访客公开信息（不含任何凭证）。昵称允许重名，身份以 id 为准。 */
export interface GuestPublic {
  id: string;
  nickname: string;
  /** 头像颜色种子，客户端据此生成稳定头像色 */
  avatarSeed: string;
  avatarIcon: AvatarIcon;
  createdAt: string;
}

export interface RoomPublic {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  /** 服务启动时创建的默认公共房间 */
  isDefault: boolean;
}

export interface MemberPublic {
  guest: GuestPublic;
  joinedAt: string;
  /** 已读进度：已连续阅读到的房间消息序号 */
  lastReadSeq: number;
  /** 该访客在本房间的有效 WebSocket 连接数；同一浏览器多标签页只算一个成员 */
  onlineCount: number;
}

/** 房间内已存储的消息（服务端签发 id/seq/时间） */
export interface StoredMessage {
  id: string;
  clientMessageId: string;
  roomId: string;
  /** 房间内单调递增序号，从 1 开始 */
  seq: number;
  senderId: string;
  kind: "text" | "image" | "file";
  text?: string;
  attachmentId?: string;
  createdAt: string;
}

export interface AttachmentPublic {
  id: string;
  roomId: string;
  ownerId: string;
  /** 原文件名仅用于显示与下载命名 */
  filename: string;
  size: number;
  mime: string;
  createdAt: string;
}

/** 消息 + 发送者快照 + 附件描述，服务端在确认、推送与分页响应中使用 */
export interface MessageView {
  message: StoredMessage;
  sender: GuestPublic;
  attachment?: AttachmentPublic;
}

/** 房间列表摘要只携带短文本预览，不包含完整长消息。 */
export interface MessagePreview {
  message: StoredMessage;
  sender: GuestPublic;
  attachment?: AttachmentPublic;
}

export interface RoomSummary {
  room: RoomPublic;
  /** 最后一条消息摘要；服务刚创建尚无消息时为空 */
  lastMessage?: MessagePreview;
  /** 自己阅读进度之后的其他成员消息数，自己的消息不计入 */
  unreadCount: number;
  memberCount: number;
  /** 最后一条消息时间，无消息时为加入时间 */
  lastActivityAt: string;
}
