/**
 * POST /api/rooms/:id/leave — 退出房间。
 */
import {
  assertWriteOrigin,
  mapValidationError,
  noStore,
  requireWriteGuest,
  requirePathParam,
} from "../../../utils/http";
import { leaveRoom } from "../../../services/room-service";

export default defineEventHandler((event) => {
  noStore(event);
  try {
    assertWriteOrigin(event);
    const guest = requireWriteGuest(event);
    const roomId = requirePathParam(event, "id");
    leaveRoom(guest, roomId);
    return { ok: true };
  } catch (error) {
    mapValidationError(error);
  }
});
