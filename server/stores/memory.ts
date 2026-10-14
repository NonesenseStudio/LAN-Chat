/**
 * 进程内内存集合（docs/implementation-plan.md 8.1 节）。
 * 服务进程关闭后全部清除；不落盘、不写入任何持久化存储。
 * 所有写入路径都在事件处理的同步临界区内完成（无 await），Node 单线程保证一致性。
 */
import type { StoredMessage } from "#shared/types/entities";
import type { AvatarIcon } from "#shared/constants/avatar";
import {
  DEFAULT_MAX_GUESTS,
  DEFAULT_MAX_MEMBERS_PER_ROOM,
  DEFAULT_MAX_MESSAGES_PER_ROOM,
  DEFAULT_MAX_ROOMS,
  DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES,
  DEFAULT_MAX_TOTAL_MESSAGE_BYTES,
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_MAX_ATTACHMENT_BYTES,
} from "#shared/constants/limits";

export interface GuestRecord {
  id: string;
  nickname: string;
  avatarSeed: string;
  avatarIcon: AvatarIcon;
  createdAt: string;
}

/** 会话只存凭证哈希，不存明文 */
export interface SessionRecord {
  tokenHash: string;
  guestId: string;
  expiresAt: number;
}

export interface RoomRecord {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  isDefault: boolean;
  /** 房间内单调递增消息序号，下一条为 nextSeq */
  nextSeq: number;
}

export interface MemberRecord {
  roomId: string;
  guestId: string;
  joinedAt: string;
  lastReadSeq: number;
}

export interface AttachmentRecord {
  id: string;
  roomId: string;
  ownerId: string;
  filename: string;
  size: number;
  mime: string;
  createdAt: string;
  /** 进程内缓冲区；不属于任何公开 DTO */
  data: Buffer;
  /** 是否已被某条消息引用；未被引用的定期回收 */
  referenced: boolean;
  /** 保留的 Buffer 可能是 multipart 请求体的视图，按底层请求体字节计费 */
  storageBytes: number;
}

/** 连接抽象：由 ws 路由注入实际收发实现，业务层不接触 CrossWS 类型 */
export interface ConnectionRecord {
  id: string;
  guestId: string;
  rooms: Set<string>;
  lastSeenAt: number;
  connectedAt: number;
  send: (text: string) => void;
  close: (code?: number, reason?: string) => void;
}

export interface RateBucket {
  tokens: number;
  updatedAt: number;
}

export interface MemoryLimits {
  maxAttachmentBytes: number;
  maxTotalAttachmentBytes: number;
  maxTotalMessageBytes: number;
  maxMessagesPerRoom: number;
  maxRooms: number;
  maxMembersPerRoom: number;
  maxConnections: number;
  maxGuests: number;
}

export interface MemoryState {
  serverInstanceId: string;
  startedAt: number;
  limits: MemoryLimits;
  guests: Map<string, GuestRecord>;
  sessions: Map<string, SessionRecord>;
  rooms: Map<string, RoomRecord>;
  /** key: `${roomId}:${guestId}` */
  members: Map<string, MemberRecord>;
  /** roomId -> guestId 集合，按加入顺序 */
  roomMemberIds: Map<string, Set<string>>;
  /** roomId -> 按 seq 升序的消息数组 */
  messages: Map<string, StoredMessage[]>;
  /** messageId -> message */
  messageIndex: Map<string, StoredMessage>;
  /** messageId -> 内存占用估算 */
  messageStorageBytes: Map<string, number>;
  storedMessageBytes: number;
  /** `${senderId}:${clientMessageId}` -> message（发送幂等键） */
  idempotency: Map<string, StoredMessage>;
  attachments: Map<string, AttachmentRecord>;
  /** 当前附件缓冲区总字节数 */
  attachmentBytes: number;
  /** 上传过程中预占的字节数；完成或失败后须释放 */
  reservedBytes: number;
  connections: Map<string, ConnectionRecord>;
  /** guestId -> connectionId 集合 */
  guestConnectionIds: Map<string, Set<string>>;
  /** `${bucket}:${guestId}` -> 令牌桶 */
  rateBuckets: Map<string, RateBucket>;
}

const STATE_KEY = Symbol.for("lan-chat.memory-state");

function createState(): MemoryState {
  return {
    serverInstanceId: crypto.randomUUID(),
    startedAt: Date.now(),
    limits: {
      maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
      maxTotalAttachmentBytes: DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES,
      maxTotalMessageBytes: DEFAULT_MAX_TOTAL_MESSAGE_BYTES,
      maxMessagesPerRoom: DEFAULT_MAX_MESSAGES_PER_ROOM,
      maxRooms: DEFAULT_MAX_ROOMS,
      maxMembersPerRoom: DEFAULT_MAX_MEMBERS_PER_ROOM,
      maxConnections: DEFAULT_MAX_CONNECTIONS,
      maxGuests: DEFAULT_MAX_GUESTS,
    },
    guests: new Map(),
    sessions: new Map(),
    rooms: new Map(),
    members: new Map(),
    roomMemberIds: new Map(),
    messages: new Map(),
    messageIndex: new Map(),
    messageStorageBytes: new Map(),
    storedMessageBytes: 0,
    idempotency: new Map(),
    attachments: new Map(),
    attachmentBytes: 0,
    reservedBytes: 0,
    connections: new Map(),
    guestConnectionIds: new Map(),
    rateBuckets: new Map(),
  };
}

/**
 * 进程级单例。用 globalThis 挂载以在开发模式模块热更替后保留内存状态，
 * 使“服务重启才清空”的行为与生产一致。
 */
export function useMemory(): MemoryState {
  const holder = globalThis as Record<symbol, unknown>;
  if (!holder[STATE_KEY]) {
    holder[STATE_KEY] = createState();
  }
  return holder[STATE_KEY] as MemoryState;
}

export function memberKey(roomId: string, guestId: string): string {
  return `${roomId}:${guestId}`;
}

export function idempotencyKey(
  senderId: string,
  clientMessageId: string,
): string {
  return `${senderId}:${clientMessageId}`;
}
