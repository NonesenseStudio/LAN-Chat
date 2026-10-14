/**
 * GET /api/capabilities — 本部署有效的限制参数。
 * maxWsMessageBytes 按部署链路核实值计算（docs/implementation-plan.md 7.5 节）。
 */
import type { CapabilitiesResponse } from "#shared/types/api";
import { resolveCapabilities } from "../utils/env";
import { noStore } from "../utils/http";
import { useMemory } from "../stores/memory";

export default defineEventHandler((event): CapabilitiesResponse => {
  noStore(event);
  const caps = resolveCapabilities();
  return {
    ...caps,
    maxConnections: useMemory().limits.maxConnections,
    serverInstanceId: useMemory().serverInstanceId,
  };
});
