/**
 * POST /api/session — 创建访客身份并签发会话 Cookie。
 * 已有有效会话时幂等返回现有身份（浏览器刷新不重复建号）。
 */
import { toGuestPublic } from "../utils/dto";
import {
  assertWriteOrigin,
  mapValidationError,
  noStore,
  readCappedJson,
} from "../utils/http";
import {
  createGuestSession,
  getSessionGuest,
  setSessionCookie,
} from "../utils/session";
import { validateNickname } from "../utils/validate";
import { assertGuestCapacity } from "../services/guest-service";
import { useMemory } from "../stores/memory";

export default defineEventHandler(async (event) => {
  noStore(event);
  try {
    assertWriteOrigin(event);
    const existing = getSessionGuest(event);
    if (existing) {
      return {
        guest: toGuestPublic(existing),
        serverInstanceId: useMemory().serverInstanceId,
      };
    }
    const body = await readCappedJson(event);
    const nickname = validateNickname(body.nickname);
    assertGuestCapacity();
    const { token, guest } = createGuestSession(nickname);
    setSessionCookie(event, token);
    return {
      guest: toGuestPublic(guest),
      serverInstanceId: useMemory().serverInstanceId,
    };
  } catch (error) {
    mapValidationError(error);
  }
});
