/**
 * HTTP 接口公共工具：会话校验、错误映射、Origin 校验、路径参数校验。
 */
import { errorText } from "#shared/constants/errors";
import type { GuestRecord } from "../stores/memory";
import type { H3Event } from "h3";
import {
  createError,
  getRouterParam,
  getRequestHeader,
  getRequestURL,
  setResponseHeader,
} from "h3";
import { getSessionGuest } from "./session";
import { ValidationError } from "./validate";
import { RATE_HTTP_WRITE } from "#shared/constants/limits";
import { consumeRate } from "./ratelimit";

const STATUS_BY_CODE: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  ATTACHMENT_NOT_FOUND: 404,
  MESSAGE_TOO_LARGE: 413,
  MESSAGE_INVALID: 400,
  ATTACHMENT_TOO_LARGE: 413,
  CAPACITY_EXCEEDED: 413,
  MESSAGE_CAPACITY_EXCEEDED: 413,
  ROOM_CAPACITY_EXCEEDED: 503,
  MEMBER_CAPACITY_EXCEEDED: 503,
  GUEST_CAPACITY_EXCEEDED: 503,
  RATE_LIMITED: 429,
  SERVER_FULL: 503,
  INTERNAL: 500,
};

/** 抛出结构化 API 错误；data 携带 { code, message } 供客户端映射中文文案 */
export function apiFail(
  code: string,
  message?: string,
  status?: number,
): never {
  throw createError({
    statusCode: status ?? STATUS_BY_CODE[code] ?? 500,
    data: { code, message: message ?? errorText(code) },
  });
}

/** 将 ValidationError 映射为结构化响应 */
export function mapValidationError(error: unknown): never {
  if (error instanceof ValidationError) {
    apiFail(error.code, error.message);
  }
  throw error;
}

/** 需要已签发的访客会话 */
export function requireGuest(event: H3Event): GuestRecord {
  const guest = getSessionGuest(event);
  if (!guest) apiFail("UNAUTHENTICATED");
  return guest;
}

/** 已鉴权的写请求共享按访客令牌桶。 */
export function requireWriteGuest(event: H3Event): GuestRecord {
  const guest = requireGuest(event);
  if (
    !consumeRate(
      "http-write",
      guest.id,
      RATE_HTTP_WRITE.capacity,
      RATE_HTTP_WRITE.refillPerSecond,
    )
  ) {
    apiFail("RATE_LIMITED");
  }
  return guest;
}

/**
 * 有副作用的请求校验 Origin：携带 Origin 时必须同源或在允许列表中。
 * SameSite=Lax Cookie 已阻止跨站表单携带凭证，这里防御显式伪造的跨源调用。
 */
export function assertWriteOrigin(event: H3Event) {
  const origin = getRequestHeader(event, "origin");
  if (!origin) return;
  if (isAllowedOrigin(event, origin)) return;
  apiFail("FORBIDDEN", "不允许的来源", 403);
}

export function isAllowedOrigin(event: H3Event, origin: string): boolean {
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = getRequestHeader(event, "host");
  if (host && originHost === host) return true;
  const configured = (process.env.LAN_CHAT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return configured.includes(origin);
}

/** WebSocket 升级请求的 Origin 校验；浏览器总是携带 Origin */
export function isAllowedUpgrade(
  cookieHeader: string | null | undefined,
  origin: string | null | undefined,
  host: string | null | undefined,
): boolean {
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  if (host && originHost === host) return true;
  const configured = (process.env.LAN_CHAT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return configured.includes(origin);
}

/** URL 路径参数：仅允许短随机 ID 字符集 */
export function requirePathParam(event: H3Event, name: string): string {
  const value = getRouterParam(event, name) ?? "";
  if (!/^[a-z0-9]{1,64}$/.test(value)) {
    apiFail("NOT_FOUND");
  }
  return value;
}

/** 统一 no-store：聊天数据与附件一律不缓存 */
export function noStore(event: H3Event) {
  try {
    setResponseHeader(event, "Cache-Control", "no-store");
  } catch {
    // 响应已发出的场景忽略
  }
}

/** 同源访问地址（邀请链接、二维码使用；绝不生成 localhost 地址） */
export function currentOrigin(event: H3Event): string {
  try {
    return getRequestURL(event).origin;
  } catch {
    return "";
  }
}

/** Node 请求流按实际字节读取；超过上限后继续丢弃数据但不再保留内存。 */
export async function readCappedRequestBody(
  event: H3Event,
  capBytes: number,
  code = "BAD_REQUEST",
  message = "请求体过大",
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of event.node.req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.byteLength;
    if (size > capBytes) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    if (!tooLarge) chunks.push(part);
  }
  if (tooLarge)
    apiFail(code, message, code === "BAD_REQUEST" ? 413 : undefined);
  if (size === 0) return undefined;
  return Buffer.concat(chunks, size);
}

/**
 * 读取并解析 JSON 请求体，按实际字节限制大小。
 * content-length 先行检查，读取后再按真实长度复核，防止伪造声明。
 */
export async function readCappedJson(
  event: H3Event,
  capBytes = 64 * 1024,
): Promise<Record<string, unknown>> {
  const rawLength = getRequestHeader(event, "content-length");
  const declared = rawLength === undefined ? 0 : Number(rawLength);
  if (
    rawLength !== undefined &&
    (!Number.isSafeInteger(declared) || declared < 0)
  ) {
    apiFail("BAD_REQUEST", "请求长度无效");
  }
  if (declared > capBytes) {
    apiFail("BAD_REQUEST", "请求体过大", 413);
  }
  const raw = await readCappedRequestBody(event, capBytes);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    apiFail("BAD_REQUEST", "请求体格式无效");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    apiFail("BAD_REQUEST", "请求体格式无效");
  }
  return parsed as Record<string, unknown>;
}
