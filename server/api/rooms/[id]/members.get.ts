/**
 * GET /api/rooms/:id/members — 成员与在线快照（需已加入房间）。
 */
import {
  mapValidationError,
  noStore,
  requireGuest,
  requirePathParam,
} from "../../../utils/http";
import { getRoomMembers } from "../../../services/room-service";

export default defineEventHandler((event) => {
  noStore(event);
  try {
    const guest = requireGuest(event);
    const roomId = requirePathParam(event, "id");
    return getRoomMembers(guest.id, roomId);
  } catch (error) {
    mapValidationError(error);
  }
});
