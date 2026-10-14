/**
 * 房间业务：默认房间、创建、加入、退出、列表与成员快照。
 * HTTP 接口调用这些函数；成员变化后由这里负责推送 room.updated / presence.updated。
 */
import type { RoomPublic, RoomSummary } from "#shared/types/entities";
import type { GuestRecord, RoomRecord } from "../stores/memory";
import { ValidationError } from "../utils/validate";
import { randomId } from "../utils/ids";
import { toMemberPublic, toRoomPublic, toRoomSummary } from "../utils/dto";
import {
  broadcastToRoom,
  computePresence,
  subscribeConnection,
  unsubscribeAllInRoom,
} from "../utils/connections";
import { memberKey, useMemory } from "../stores/memory";

export const DEFAULT_ROOM_ID = "lobby";
export const DEFAULT_ROOM_NAME = "公共房间";

/** 服务启动时创建默认公共房间 */
export function ensureDefaultRoom(): RoomRecord {
  const state = useMemory();
  let room = state.rooms.get(DEFAULT_ROOM_ID);
  if (!room) {
    room = {
      id: DEFAULT_ROOM_ID,
      name: DEFAULT_ROOM_NAME,
      createdBy: "system",
      createdAt: new Date().toISOString(),
      isDefault: true,
      nextSeq: 1,
    };
    state.rooms.set(room.id, room);
    state.roomMemberIds.set(room.id, new Set());
    state.messages.set(room.id, []);
  }
  return room;
}

function getRoom(roomId: string): RoomRecord {
  const room = useMemory().rooms.get(roomId);
  if (!room)
    throw new ValidationError("ROOM_NOT_FOUND", "房间不存在或已被清除");
  return room;
}

function requireMember(roomId: string, guestId: string) {
  const member = useMemory().members.get(memberKey(roomId, guestId));
  if (!member) throw new ValidationError("FORBIDDEN", "你尚未加入这个房间");
  return member;
}

/** 将该访客当前所有连接订阅到房间（成员关系变化时调用） */
function subscribeGuestToRoom(guestId: string, roomId: string) {
  const state = useMemory();
  for (const id of state.guestConnectionIds.get(guestId) ?? []) {
    subscribeConnection(id, roomId);
  }
}

export function createRoom(creator: GuestRecord, name: string): RoomRecord {
  const state = useMemory();
  if (state.rooms.size >= state.limits.maxRooms) {
    throw new ValidationError(
      "ROOM_CAPACITY_EXCEEDED",
      "房间数量已达上限，请联系服务启动者",
    );
  }
  const room: RoomRecord = {
    id: randomId(10),
    name,
    createdBy: creator.id,
    createdAt: new Date().toISOString(),
    isDefault: false,
    nextSeq: 1,
  };
  state.rooms.set(room.id, room);
  state.roomMemberIds.set(room.id, new Set());
  state.messages.set(room.id, []);
  // 创建者自动加入（成员上限内必然成功）
  return joinRoom(creator, room.id, { notify: false });
}

export interface JoinResult {
  room: RoomPublic;
  alreadyMember: boolean;
}

export function joinRoom(
  guest: GuestRecord,
  roomId: string,
  options: { notify?: boolean } = {},
): RoomRecord & { alreadyMember: boolean } {
  const state = useMemory();
  const room = getRoom(roomId);
  const existing = state.members.get(memberKey(roomId, guest.id));
  if (existing) {
    // 幂等：重复加入返回现状，但仍确保连接已订阅
    subscribeGuestToRoom(guest.id, roomId);
    return { ...room, alreadyMember: true };
  }
  const memberIds = state.roomMemberIds.get(roomId);
  if (memberIds && memberIds.size >= state.limits.maxMembersPerRoom) {
    throw new ValidationError(
      "MEMBER_CAPACITY_EXCEEDED",
      "房间成员已达上限，请联系服务启动者",
    );
  }
  const joinedAt = new Date().toISOString();
  state.members.set(memberKey(roomId, guest.id), {
    roomId,
    guestId: guest.id,
    joinedAt,
    lastReadSeq: 0,
  });
  memberIds?.add(guest.id);
  subscribeGuestToRoom(guest.id, roomId);
  if (options.notify !== false) {
    const members = [...(state.roomMemberIds.get(roomId) ?? [])]
      .map((id) => state.members.get(memberKey(roomId, id)))
      .filter((m) => m !== undefined)
      .map(toMemberPublic);
    broadcastToRoom(roomId, {
      v: 1,
      type: "room.updated",
      roomId,
      payload: {
        roomId,
        room: toRoomPublic(room),
        reason: "member_joined",
        guest: {
          id: guest.id,
          nickname: guest.nickname,
          avatarSeed: guest.avatarSeed,
          avatarIcon: guest.avatarIcon,
          createdAt: guest.createdAt,
        },
        members,
      },
    });
    broadcastToRoom(roomId, {
      v: 1,
      type: "presence.updated",
      roomId,
      payload: { roomId, members: computePresence(roomId) },
    });
  }
  return { ...room, alreadyMember: false };
}

export function leaveRoom(guest: GuestRecord, roomId: string): RoomRecord {
  const state = useMemory();
  const room = getRoom(roomId);
  const member = state.members.get(memberKey(roomId, guest.id));
  if (!member) throw new ValidationError("FORBIDDEN", "你尚未加入这个房间");
  state.members.delete(memberKey(roomId, guest.id));
  state.roomMemberIds.get(roomId)?.delete(guest.id);
  unsubscribeAllInRoom(guest.id, roomId);
  // 通知仍在房间内的连接；退出者自身连接已退订，不会收到
  const members = [...(state.roomMemberIds.get(roomId) ?? [])]
    .map((id) => state.members.get(memberKey(roomId, id)))
    .filter((m) => m !== undefined)
    .map(toMemberPublic);
  broadcastToRoom(roomId, {
    v: 1,
    type: "room.updated",
    roomId,
    payload: {
      roomId,
      room: toRoomPublic(room),
      reason: "member_left",
      guest: {
        id: guest.id,
        nickname: guest.nickname,
        avatarSeed: guest.avatarSeed,
        avatarIcon: guest.avatarIcon,
        createdAt: guest.createdAt,
      },
      members,
    },
  });
  broadcastToRoom(roomId, {
    v: 1,
    type: "presence.updated",
    roomId,
    payload: { roomId, members: computePresence(roomId) },
  });
  return room;
}

export function listJoinedRooms(selfId: string): RoomSummary[] {
  const state = useMemory();
  const summaries: RoomSummary[] = [];
  for (const room of state.rooms.values()) {
    if (state.members.has(memberKey(room.id, selfId))) {
      summaries.push(toRoomSummary(room, selfId));
    }
  }
  // 按最后活动时间倒序
  summaries.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return summaries;
}

export function getRoomMembers(selfId: string, roomId: string) {
  const state = useMemory();
  const room = getRoom(roomId);
  requireMember(roomId, selfId);
  const members = [...(state.roomMemberIds.get(roomId) ?? [])]
    .map((id) => state.members.get(memberKey(roomId, id)))
    .filter((m) => m !== undefined)
    .map(toMemberPublic);
  // 加入时间排序，创建者视角更稳定
  members.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  return { room: toRoomPublic(room), members };
}

/** 访客资料变化后广播到其所在全部房间，用于昵称/头像刷新 */
export function broadcastProfileUpdate(guest: GuestRecord) {
  const state = useMemory();
  const roomIds = new Set<string>();
  for (const member of state.members.values()) {
    if (member.guestId === guest.id) roomIds.add(member.roomId);
  }
  const guestPublic = {
    id: guest.id,
    nickname: guest.nickname,
    avatarSeed: guest.avatarSeed,
    avatarIcon: guest.avatarIcon,
    createdAt: guest.createdAt,
  };
  for (const roomId of roomIds) {
    const room = state.rooms.get(roomId);
    if (!room) continue;
    broadcastToRoom(roomId, {
      v: 1,
      type: "room.updated",
      roomId,
      payload: {
        roomId,
        room: toRoomPublic(room),
        reason: "profile",
        guest: guestPublic,
      },
    });
  }
}
