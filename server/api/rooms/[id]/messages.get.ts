/**
 * GET /api/rooms/:id/messages — 历史分页。
 * beforeSeq 向上翻页；afterSeq(+throughSeq) 用于断线补齐，避免越过同步边界。
 */
import type { RoomMessagesResponse } from "#shared/types/api";
import {
  mapValidationError,
  noStore,
  requireGuest,
  requirePathParam,
} from "../../../utils/http";
import { getRoomMessages } from "../../../services/message-service";
import { MAX_PAGE_LIMIT } from "#shared/constants/limits";

function intParam(raw: unknown): number | undefined {
  if (typeof raw !== "string" || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return undefined;
  return value;
}

export default defineEventHandler((event): RoomMessagesResponse => {
  noStore(event);
  try {
    const guest = requireGuest(event);
    const roomId = requirePathParam(event, "id");
    const query = getQuery(event);
    const limit = intParam(query.limit);
    const page = getRoomMessages(guest.id, roomId, {
      beforeSeq: intParam(query.beforeSeq),
      afterSeq: intParam(query.afterSeq),
      throughSeq: intParam(query.throughSeq),
      limit: limit === undefined ? undefined : Math.min(limit, MAX_PAGE_LIMIT),
    });
    return page;
  } catch (error) {
    mapValidationError(error);
  }
});
