/**
 * 令牌桶频率限制（按访客）。容量限制属于服务容量，不作为文字字数限制展示。
 */
import type { RateBucket } from "../stores/memory";
import { useMemory } from "../stores/memory";

export function consumeRate(
  bucketName: string,
  guestId: string,
  capacity: number,
  refillPerSecond: number,
): boolean {
  const state = useMemory();
  const key = `${bucketName}:${guestId}`;
  const now = Date.now();
  const bucket: RateBucket = state.rateBuckets.get(key) ?? {
    tokens: capacity,
    updatedAt: now,
  };
  const elapsed = (now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSecond);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) {
    state.rateBuckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  state.rateBuckets.set(key, bucket);
  return true;
}
