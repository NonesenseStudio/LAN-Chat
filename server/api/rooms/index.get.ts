/**
 * GET /api/rooms — 已加入房间、最后消息摘要与未读数。
 */
import { mapValidationError, noStore, requireGuest } from "../../utils/http";
import { listJoinedRooms } from "../../services/room-service";
import { useMemory } from "../../stores/memory";

export default defineEventHandler((event) => {
  noStore(event);
  try {
    const guest = requireGuest(event);
    return {
      serverInstanceId: useMemory().serverInstanceId,
      rooms: listJoinedRooms(guest.id),
    };
  } catch (error) {
    mapValidationError(error);
  }
});
