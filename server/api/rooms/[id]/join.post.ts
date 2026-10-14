/**
 * POST /api/rooms/:id/join — 加入公共房间（幂等；重复加入返回现状）。
 */
import { toRoomPublic } from "../../../utils/dto";
import {
  assertWriteOrigin,
  mapValidationError,
  noStore,
  requireWriteGuest,
  requirePathParam,
} from "../../../utils/http";
import { getRoomMembers, joinRoom } from "../../../services/room-service";

export default defineEventHandler((event) => {
  noStore(event);
  try {
    assertWriteOrigin(event);
    const guest = requireWriteGuest(event);
    const roomId = requirePathParam(event, "id");
    const room = joinRoom(guest, roomId);
    const members = getRoomMembers(guest.id, roomId).members;
    return {
      room: toRoomPublic(room),
      members,
    };
  } catch (error) {
    mapValidationError(error);
  }
});
