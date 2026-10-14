/**
 * DELETE /api/session — 退出当前会话并断开其全部连接。
 */
import {
  assertWriteOrigin,
  mapValidationError,
  noStore,
  requireWriteGuest,
} from "../utils/http";
import { closeGuestConnections } from "../utils/connections";
import { destroySession } from "../utils/session";

export default defineEventHandler((event) => {
  noStore(event);
  try {
    assertWriteOrigin(event);
    requireWriteGuest(event);
    const guest = destroySession(event);
    if (guest) closeGuestConnections(guest.id, 4000, "logout");
    return { ok: true };
  } catch (error) {
    mapValidationError(error);
  }
});
