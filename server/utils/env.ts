/**
 * 运行时限制解析：环境变量覆盖默认值（docs/implementation-plan.md 7.5/8.3 节）。
 * 发布给客户端的 maxWsMessageBytes 按部署链路核实值计算：
 * L = min(Node 接收上限（CrossWS 默认 100 MiB），代理配置值，显式覆盖值)
 */
import {
  DEFAULT_MAX_ATTACHMENT_BYTES,
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_MAX_GUESTS,
  DEFAULT_MAX_MEMBERS_PER_ROOM,
  DEFAULT_MAX_MESSAGES_PER_ROOM,
  DEFAULT_MAX_ROOMS,
  DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES,
  DEFAULT_MAX_TOTAL_MESSAGE_BYTES,
  ENV_MAX_TOTAL_MESSAGE_BYTES,
  ENV_MAX_WS_MESSAGE_BYTES,
  ENV_PROXY_WS_MESSAGE_LIMIT,
  NODE_WS_MAX_PAYLOAD_BYTES,
} from "#shared/constants/limits";
import { useMemory } from "../stores/memory";

function readPositiveIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return Math.floor(value);
}

/** 解析后的部署能力参数；进程内不变，供接口与 WS 会话发布 */
export function resolveCapabilities() {
  const proxyLimit = readPositiveIntEnv(ENV_PROXY_WS_MESSAGE_LIMIT);
  const explicit = readPositiveIntEnv(ENV_MAX_WS_MESSAGE_BYTES);
  let effective = NODE_WS_MAX_PAYLOAD_BYTES;
  if (proxyLimit !== undefined) effective = Math.min(effective, proxyLimit);
  if (explicit !== undefined) effective = Math.min(effective, explicit);
  return {
    maxWsMessageBytes: effective,
    maxAttachmentBytes:
      readPositiveIntEnv("LAN_CHAT_MAX_ATTACHMENT_BYTES") ??
      DEFAULT_MAX_ATTACHMENT_BYTES,
    maxTotalAttachmentBytes:
      readPositiveIntEnv("LAN_CHAT_MAX_TOTAL_ATTACHMENT_BYTES") ??
      DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES,
    maxTotalMessageBytes:
      readPositiveIntEnv(ENV_MAX_TOTAL_MESSAGE_BYTES) ??
      DEFAULT_MAX_TOTAL_MESSAGE_BYTES,
  };
}

/** 将环境限制写入内存状态；由启动插件调用一次 */
export function applyMemoryLimits() {
  const state = useMemory();
  const caps = resolveCapabilities();
  state.limits.maxAttachmentBytes = caps.maxAttachmentBytes;
  state.limits.maxTotalAttachmentBytes = caps.maxTotalAttachmentBytes;
  state.limits.maxTotalMessageBytes = caps.maxTotalMessageBytes;
  state.limits.maxMessagesPerRoom =
    readPositiveIntEnv("LAN_CHAT_MAX_MESSAGES_PER_ROOM") ??
    DEFAULT_MAX_MESSAGES_PER_ROOM;
  state.limits.maxRooms =
    readPositiveIntEnv("LAN_CHAT_MAX_ROOMS") ?? DEFAULT_MAX_ROOMS;
  state.limits.maxMembersPerRoom =
    readPositiveIntEnv("LAN_CHAT_MAX_MEMBERS_PER_ROOM") ??
    DEFAULT_MAX_MEMBERS_PER_ROOM;
  state.limits.maxConnections =
    readPositiveIntEnv("LAN_CHAT_MAX_CONNECTIONS") ?? DEFAULT_MAX_CONNECTIONS;
  state.limits.maxGuests =
    readPositiveIntEnv("LAN_CHAT_MAX_GUESTS") ?? DEFAULT_MAX_GUESTS;
  return caps;
}
