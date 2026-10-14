/**
 * 访客会话：签发、校验、撤销（docs/implementation-plan.md 9.4 节）。
 * Cookie 属性 HttpOnly + SameSite=Lax，HTTPS 时 Secure；不写入 JS 可读存储。
 */
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "#shared/constants/limits";
import type { H3Event } from "h3";
import { getCookie, getRequestHeader, setCookie } from "h3";
import { hashToken, newSessionToken, randomId } from "./ids";
import { useMemory, type GuestRecord } from "../stores/memory";
import { DEFAULT_AVATAR_ICON } from "#shared/constants/avatar";

function secureCookie(event: H3Event): boolean {
  if (process.env.LAN_CHAT_TRUST_PROXY === "1") {
    const forwardedProto = getRequestHeader(event, "x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .toLowerCase();
    if (forwardedProto) return forwardedProto === "https";
  }
  try {
    return getRequestURL(event).protocol === "https:";
  } catch {
    return false;
  }
}

function sessionCookieOptions(event: H3Event) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookie(event),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

function pruneExpiredSessions() {
  const state = useMemory();
  const now = Date.now();
  for (const [hash, session] of state.sessions) {
    if (session.expiresAt <= now) state.sessions.delete(hash);
  }
}

export interface IssuedSession {
  token: string;
  guest: GuestRecord;
}

/** 创建访客身份并签发会话；昵称已由调用方校验 */
export function createGuestSession(nickname: string): IssuedSession {
  const state = useMemory();
  pruneExpiredSessions();
  const guest: GuestRecord = {
    id: randomId(16),
    nickname,
    avatarSeed: randomId(8),
    avatarIcon: DEFAULT_AVATAR_ICON,
    createdAt: new Date().toISOString(),
  };
  state.guests.set(guest.id, guest);
  const token = newSessionToken();
  const record = {
    tokenHash: hashToken(token),
    guestId: guest.id,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  state.sessions.set(record.tokenHash, record);

  return { token, guest };
}

/** 从 Cookie 恢复会话对应的访客；失效返回 undefined */
export function getSessionGuest(event: H3Event): GuestRecord | undefined {
  const token = getCookie(event, SESSION_COOKIE_NAME);
  if (!token) return undefined;
  const state = useMemory();
  const record = state.sessions.get(hashToken(token));
  if (!record) return undefined;
  if (record.expiresAt <= Date.now()) {
    state.sessions.delete(record.tokenHash);
    return undefined;
  }
  return state.guests.get(record.guestId);
}

/** 从原始 Cookie 头解析会话（WebSocket 升级请求没有 H3Event） */
export function getSessionGuestFromCookieHeader(
  cookieHeader: string | undefined,
): GuestRecord | undefined {
  if (!cookieHeader) return undefined;
  const pair = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!pair) return undefined;
  let token: string;
  try {
    token = decodeURIComponent(pair.slice(SESSION_COOKIE_NAME.length + 1));
  } catch {
    return undefined;
  }
  if (!token) return undefined;
  const state = useMemory();
  const record = state.sessions.get(hashToken(token));
  if (!record || record.expiresAt <= Date.now()) return undefined;
  return state.guests.get(record.guestId);
}

/** 写入会话 Cookie（新建或续期） */
export function setSessionCookie(event: H3Event, token: string) {
  setCookie(event, SESSION_COOKIE_NAME, token, sessionCookieOptions(event));
}

/** 清除 Cookie 并删除会话记录；返回被撤销的访客（用于断开连接） */
export function destroySession(event: H3Event): GuestRecord | undefined {
  const guest = getSessionGuest(event);
  const token = getCookie(event, SESSION_COOKIE_NAME);
  if (token) useMemory().sessions.delete(hashToken(token));
  setCookie(event, SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(event),
    path: "/",
    maxAge: 0,
  });
  return guest;
}
