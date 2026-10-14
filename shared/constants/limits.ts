/**
 * 限制与默认值（docs/implementation-plan.md 6/7/8 节）。
 * 这些是服务容量参数，不是文字字数业务限制；部署可用环境变量覆盖，
 * 实际生效值由 GET /api/capabilities 与 session.ready 发布。
 */

/** CrossWS 0.3.5 Node 适配器（内置 ws）默认 maxPayload = 100 MiB，已核对本地实现 */
export const NODE_WS_MAX_PAYLOAD_BYTES = 104_857_600;

/** 代理链路已核实的 WebSocket 消息上限；未配置时不额外降低 L */
export const ENV_PROXY_WS_MESSAGE_LIMIT = "LAN_CHAT_PROXY_WS_MESSAGE_LIMIT";
/** 覆盖发布的有效 WebSocket 消息上限（须 ≤ Node 接收上限） */
export const ENV_MAX_WS_MESSAGE_BYTES = "LAN_CHAT_MAX_WS_MESSAGE_BYTES";
export const ENV_MAX_TOTAL_MESSAGE_BYTES = "LAN_CHAT_MAX_TOTAL_MESSAGE_BYTES";

export const NICKNAME_MAX_LENGTH = 30;
export const ROOM_NAME_MAX_LENGTH = 30;

/** 历史分页 */
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;
export const MAX_HISTORY_RESPONSE_BYTES = 2 * 1024 * 1024;

/** 服务容量参数（可通过对应环境变量覆盖；见 server/utils/env.ts） */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB（含 multipart 开销前）
export const DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES = 256 * 1024 * 1024; // 256 MB
export const DEFAULT_MAX_TOTAL_MESSAGE_BYTES = 512 * 1024 * 1024; // 512 MB 估算内存预算
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const DEFAULT_MAX_MESSAGES_PER_ROOM = 5000;
export const DEFAULT_MAX_ROOMS = 200;
export const DEFAULT_MAX_MEMBERS_PER_ROOM = 200;
export const DEFAULT_MAX_CONNECTIONS = 200;
export const DEFAULT_MAX_GUESTS = 1000;

/** 频率限制：令牌桶参数（每访客） */
export const RATE_MESSAGE_SEND = { capacity: 30, refillPerSecond: 1 } as const;
export const RATE_ROOM_READ = { capacity: 120, refillPerSecond: 6 } as const;
export const RATE_HTTP_WRITE = { capacity: 60, refillPerSecond: 2 } as const;

/** 附件回收：未被消息引用的上传缓冲区保留时长 */
export const UNREFERENCED_ATTACHMENT_TTL_MS = 30 * 60 * 1000;
/** 会话有效期；浏览器刷新后凭同一 Cookie 恢复身份 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "lanchat_session";

/** 心跳参数（7.1 节，客户端使用） */
export const HEARTBEAT_INTERVAL_MS = 25_000;
export const HEARTBEAT_TIMEOUT_MS = 60_000;
export const ACK_TIMEOUT_MS = 10_000;
/** 重连退避基数（毫秒），指数增长，封顶 30s */
export const RECONNECT_BASE_DELAYS_MS = [1000, 2000, 4000, 8000] as const;
export const RECONNECT_MAX_DELAY_MS = 30_000;

/** message.created/message.ack 会比客户端发送事件多出服务端签发字段 */
export const WS_SERVER_MESSAGE_OVERHEAD_BYTES = 4096;
