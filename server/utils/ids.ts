/**
 * 服务端签发的高熵 ID 与会话凭证。
 * 会话 Cookie 只保存随机凭证，内存中仅保留其 SHA-256 哈希。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/** 短随机 ID：用于房间等出现在 URL 中的资源 */
export function randomId(length = 10): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  }
  return out;
}

/** 会话凭证：高熵随机串，仅出现在 HttpOnly Cookie 中 */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
