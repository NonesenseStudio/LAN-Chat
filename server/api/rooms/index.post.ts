/**
 * POST /api/rooms — 创建房间，创建者自动加入。
 */
import { toRoomPublic } from "../../utils/dto";
import {
  assertWriteOrigin,
  mapValidationError,
  noStore,
  readCappedJson,
  requireWriteGuest,
} from "../../utils/http";
import { createRoom } from "../../services/room-service";
import { validateRoomName } from "../../utils/validate";

export default defineEventHandler(async (event) => {
  noStore(event);
  try {
    assertWriteOrigin(event);
    const guest = requireWriteGuest(event);
    const body = await readCappedJson(event);
    const name = validateRoomName(body.name);
    const room = createRoom(guest, name);
    return { room: toRoomPublic(room) };
  } catch (error) {
    mapValidationError(error);
  }
});
