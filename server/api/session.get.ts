/**
 * GET /api/session — 恢复身份与当前会话信息；无有效会话返回 401。
 */
import { toGuestPublic } from "../utils/dto";
import { apiFail, mapValidationError, noStore } from "../utils/http";
import { getSessionGuest } from "../utils/session";
import { useMemory } from "../stores/memory";

export default defineEventHandler((event) => {
  noStore(event);
  try {
    const guest = getSessionGuest(event);
    if (!guest) apiFail("UNAUTHENTICATED");
    return {
      guest: toGuestPublic(guest),
      serverInstanceId: useMemory().serverInstanceId,
    };
  } catch (error) {
    mapValidationError(error);
  }
});
