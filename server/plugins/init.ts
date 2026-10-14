/**
 * 服务启动插件：应用环境限制、创建默认公共房间、启动定期清理。
 * 服务进程重启后所有内存状态重新开始（docs/implementation-plan.md 7.1 节）。
 */
import { applyMemoryLimits } from "../utils/env";
import {
  removeRoomAttachments,
  sweepUnreferencedAttachments,
} from "../services/attachment-service";
import { ensureDefaultRoom } from "../services/room-service";
import {
  broadcastToRoom,
  computePresence,
  unregisterConnection,
} from "../utils/connections";
import { useMemory } from "../stores/memory";

const SWEEP_KEY = Symbol.for("lan-chat.sweeper-timer");
const SWEEP_INTERVAL_MS = 60_000;
/** 连接静默超时：客户端每 25s 心跳，120s 无任何流量视为死连接 */
const CONNECTION_IDLE_MS = 120_000;

export default defineNitroPlugin(() => {
  applyMemoryLimits();
  ensureDefaultRoom();

  const holder = globalThis as Record<symbol, NodeJS.Timeout | undefined>;
  if (holder[SWEEP_KEY]) return;

  holder[SWEEP_KEY] = setInterval(() => {
    const state = useMemory();
    const now = Date.now();
    // 清理静默连接（移动端后台、断网等未正常关闭的对端）
    for (const connection of [...state.connections.values()]) {
      if (now - connection.lastSeenAt > CONNECTION_IDLE_MS) {
        try {
          connection.close(1001, "idle-timeout");
        } catch {
          // 已断开
        }
        const rooms = unregisterConnection(connection.id);
        for (const roomId of rooms) {
          if (!state.rooms.has(roomId)) continue;
          broadcastToRoom(roomId, {
            v: 1,
            type: "presence.updated",
            roomId,
            payload: { roomId, members: computePresence(roomId) },
          });
        }
      }
    }
    // 回收未被消息引用的附件缓冲区
    const freed = sweepUnreferencedAttachments();
    if (freed > 0) {
      console.info(
        `[sweep] 回收未引用附件 ${(freed / 1024 / 1024).toFixed(1)}MB`,
      );
    }
    // 清理长期无成员的房间（默认房间除外）
    for (const room of [...state.rooms.values()]) {
      if (room.isDefault) continue;
      const members = state.roomMemberIds.get(room.id);
      if (
        members &&
        members.size === 0 &&
        now - Date.parse(room.createdAt) > 60 * 60_000
      ) {
        state.rooms.delete(room.id);
        state.roomMemberIds.delete(room.id);
        const messages = state.messages.get(room.id) ?? [];
        for (const message of messages) {
          state.messageIndex.delete(message.id);
          state.idempotency.delete(
            `${message.senderId}:${message.clientMessageId}`,
          );
          const bytes = state.messageStorageBytes.get(message.id) ?? 0;
          state.messageStorageBytes.delete(message.id);
          state.storedMessageBytes = Math.max(
            0,
            state.storedMessageBytes - bytes,
          );
        }
        state.messages.delete(room.id);
        removeRoomAttachments(room.id);
      }
    }
  }, SWEEP_INTERVAL_MS);
  // 不阻止进程退出
  holder[SWEEP_KEY]?.unref?.();
});
