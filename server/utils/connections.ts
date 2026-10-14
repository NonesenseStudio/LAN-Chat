/**
 * WebSocket 连接注册表与事件广播。
 * 连接生命周期由 server/routes/ws.ts 驱动；HTTP 接口完成房间操作后
 * 也通过这里通知相关连接（docs/implementation-plan.md 7.2 节）。
 */
import type {
  PresenceMemberState,
  WsServerEvent,
} from "#shared/types/protocol";
import { memberKey, useMemory, type ConnectionRecord } from "../stores/memory";

export function registerConnection(connection: ConnectionRecord) {
  const state = useMemory();
  state.connections.set(connection.id, connection);
  const set = state.guestConnectionIds.get(connection.guestId) ?? new Set();
  set.add(connection.id);
  state.guestConnectionIds.set(connection.guestId, set);
}

export function unregisterConnection(connectionId: string) {
  const state = useMemory();
  const connection = state.connections.get(connectionId);
  if (!connection) return [];
  state.connections.delete(connectionId);
  const rooms = [...connection.rooms];
  for (const roomId of rooms) connection.rooms.delete(roomId);
  const set = state.guestConnectionIds.get(connection.guestId);
  if (set) {
    set.delete(connectionId);
    if (set.size === 0) state.guestConnectionIds.delete(connection.guestId);
  }
  // 返回该连接退订的房间，供在线状态重算
  return rooms;
}

export function subscribeConnection(
  connectionId: string,
  roomId: string,
): boolean {
  const state = useMemory();
  const connection = state.connections.get(connectionId);
  if (!connection) return false;
  connection.rooms.add(roomId);
  return true;
}

export function unsubscribeAllInRoom(guestId: string, roomId: string) {
  const state = useMemory();
  const ids = state.guestConnectionIds.get(guestId);
  if (!ids) return;
  for (const id of ids) {
    state.connections.get(id)?.rooms.delete(roomId);
  }
}

export function sendToConnection(connectionId: string, event: WsServerEvent) {
  const connection = useMemory().connections.get(connectionId);
  if (!connection) return;
  try {
    connection.send(JSON.stringify(event));
  } catch {
    // 发送失败交由心跳与 close 生命周期处理
  }
}

export function broadcastToRoom(
  roomId: string,
  event: WsServerEvent,
  excludeConnectionIds: Set<string> = new Set(),
) {
  const state = useMemory();
  const text = JSON.stringify(event);
  for (const connection of state.connections.values()) {
    if (
      connection.rooms.has(roomId) &&
      !excludeConnectionIds.has(connection.id)
    ) {
      try {
        connection.send(text);
      } catch {
        // 同上
      }
    }
  }
}

/** 推送到某访客的所有连接（如阅读进度同步） */
export function broadcastToGuest(guestId: string, event: WsServerEvent) {
  const state = useMemory();
  const ids = state.guestConnectionIds.get(guestId);
  if (!ids) return;
  const text = JSON.stringify(event);
  for (const id of ids) {
    const connection = state.connections.get(id);
    if (!connection) continue;
    try {
      connection.send(text);
    } catch {
      // 发送失败交由心跳与 close 生命周期处理
    }
  }
}

/** 断开某访客的全部连接（退出登录、会话失效） */
export function closeGuestConnections(
  guestId: string,
  code = 4001,
  reason = "session-ended",
) {
  const state = useMemory();
  const ids = [...(state.guestConnectionIds.get(guestId) ?? [])];
  const changedRooms = new Set<string>();
  for (const id of ids) {
    const connection = state.connections.get(id);
    if (connection) {
      for (const roomId of connection.rooms) changedRooms.add(roomId);
      unregisterConnection(id);
      try {
        connection.close(code, reason);
      } catch {
        // 连接可能已断开
      }
    }
  }
  state.guestConnectionIds.delete(guestId);
  for (const roomId of changedRooms) {
    if (!state.rooms.has(roomId)) continue;
    broadcastToRoom(roomId, {
      v: 1,
      type: "presence.updated",
      roomId,
      payload: { roomId, members: computePresence(roomId) },
    });
  }
}

/** 按“访客 + 房间”的有效连接数统计在线状态 */
export function computePresence(roomId: string): PresenceMemberState[] {
  const state = useMemory();
  const counts = new Map<string, number>();
  const memberIds = state.roomMemberIds.get(roomId);
  if (!memberIds) return [];
  for (const connection of state.connections.values()) {
    if (connection.rooms.has(roomId) && memberIds.has(connection.guestId)) {
      counts.set(connection.guestId, (counts.get(connection.guestId) ?? 0) + 1);
    }
  }
  return [...memberIds].map((guestId) => ({
    guestId,
    onlineCount: counts.get(guestId) ?? 0,
  }));
}

export function isGuestOnlineInRoom(roomId: string, guestId: string): number {
  const state = useMemory();
  let count = 0;
  for (const connection of state.connections.values()) {
    if (connection.guestId === guestId && connection.rooms.has(roomId)) count++;
  }
  return count;
}

export function memberRecord(roomId: string, guestId: string) {
  return useMemory().members.get(memberKey(roomId, guestId));
}
