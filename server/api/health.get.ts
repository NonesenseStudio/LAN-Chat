/**
 * GET /api/health — 服务可用状态与实例标识。
 * 详细内存指标只记录到服务端日志，不对外暴露。
 */
import type { HealthResponse } from "#shared/types/api";
import { noStore } from "../utils/http";
import { memoryUsage } from "../services/attachment-service";
import { useMemory } from "../stores/memory";

export default defineEventHandler((event): HealthResponse => {
  noStore(event);
  const state = useMemory();
  const usage = memoryUsage();
  console.info(
    `[health] instance=${state.serverInstanceId} guests=${state.guests.size} rooms=${state.rooms.size}` +
      ` messages=${state.messageIndex.size} messageBytes≈${state.storedMessageBytes}` +
      ` connections=${state.connections.size} attachments=${usage.attachmentCount}` +
      ` attachmentBytes=${usage.attachmentBytes} reservedBytes=${usage.reservedBytes}` +
      ` rss=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
  );
  return { ok: true, serverInstanceId: state.serverInstanceId };
});
