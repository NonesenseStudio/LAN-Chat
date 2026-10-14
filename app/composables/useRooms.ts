/**
 * 房间列表状态：已加入房间、未读、在线状态、创建/加入/退出动作。
 * 服务端事件 room.updated / presence.updated 在此落地；消息事件只更新摘要与未读。
 */
import type {
  MessageView,
  RoomPublic,
  RoomSummary,
} from "#shared/types/entities";
import type {
  PresenceMemberState,
  RoomUpdatedPayload,
} from "#shared/types/protocol";
import type {
  JoinRoomResponse,
  RoomListResponse,
  RoomMembersResponse,
} from "#shared/types/api";

export const DEFAULT_ROOM_ID = "lobby";

/** 成员关系变化后由编排层重新申请订阅（HTTP 加入/创建/退出后 WebSocket 需补订阅） */
let membershipHook: (() => void) | null = null;

export function setRoomsMembershipHook(hook: (() => void) | null) {
  membershipHook = hook;
}

function notifyMembershipChanged() {
  membershipHook?.();
}

export function useRooms() {
  const rooms = useState<RoomSummary[]>("rooms", () => []);
  /** 各房间在线成员快照（presence.updated） */
  const presence = useState<Record<string, PresenceMemberState[]>>(
    "room-presence",
    () => ({}),
  );
  const loading = useState<boolean>("rooms-loading", () => false);
  const session = useSession();

  const sortedRooms = computed(() =>
    [...rooms.value].sort(
      (a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
    ),
  );

  const totalUnread = computed(() =>
    rooms.value.reduce((sum, room) => sum + room.unreadCount, 0),
  );

  function roomById(roomId: string): RoomSummary | undefined {
    return rooms.value.find((room) => room.room.id === roomId);
  }

  /** 拉取已加入房间列表（服务端计算未读，作为权威校准） */
  async function refresh(): Promise<void> {
    loading.value = true;
    try {
      const data = await apiFetch<RoomListResponse>("/api/rooms");
      rooms.value = data.rooms;
    } finally {
      loading.value = false;
    }
  }

  async function createRoom(name: string): Promise<RoomPublic> {
    const data = await apiFetch<{ room: RoomPublic }>("/api/rooms", {
      method: "POST",
      body: { name },
    });
    await refresh();
    notifyMembershipChanged();
    return data.room;
  }

  /** 加入房间；幂等，返回成员快照 */
  async function join(roomId: string): Promise<JoinRoomResponse> {
    const data = await apiFetch<JoinRoomResponse>(`/api/rooms/${roomId}/join`, {
      method: "POST",
      body: {},
    });
    // 本地列表可能还没有该房间（链接直达场景），刷新补齐
    if (!roomById(roomId)) {
      await refresh();
    }
    notifyMembershipChanged();
    return data;
  }

  async function leave(roomId: string): Promise<void> {
    await apiFetch(`/api/rooms/${roomId}/leave`, { method: "POST", body: {} });
    rooms.value = rooms.value.filter((room) => room.room.id !== roomId);
    delete presence.value[roomId];
    notifyMembershipChanged();
  }

  async function fetchMembers(roomId: string): Promise<RoomMembersResponse> {
    return apiFetch<RoomMembersResponse>(`/api/rooms/${roomId}/members`);
  }

  function upsertFromSync(room: RoomPublic, lastActivityAt?: string) {
    const existing = roomById(room.id);
    if (existing) {
      existing.room = room;
    } else {
      rooms.value = [
        ...rooms.value,
        {
          room,
          unreadCount: 0,
          memberCount: 0,
          lastActivityAt: lastActivityAt ?? new Date().toISOString(),
        },
      ];
    }
  }

  /** 新消息到达：更新摘要、时间与未读；当前正在阅读的房间由已读推进消零 */
  function onMessageCreated(
    roomId: string,
    view: MessageView,
    isOwn: boolean,
    activeInView: boolean,
  ) {
    const room = roomById(roomId);
    if (!room) return;
    room.lastMessage = view;
    room.lastActivityAt = view.message.createdAt;
    if (!isOwn && !activeInView) {
      room.unreadCount++;
    }
    rooms.value = [...rooms.value];
  }

  /** 本人已读推进：该房间未读清零（其他成员消息均在 lastReadSeq 之前） */
  function onOwnReadUpdated(roomId: string) {
    const room = roomById(roomId);
    if (!room) return;
    room.unreadCount = 0;
    rooms.value = [...rooms.value];
  }

  function applyRoomUpdated(payload: RoomUpdatedPayload) {
    const updatedGuest =
      payload.reason === "profile" ? payload.guest : undefined;
    if (updatedGuest) {
      rooms.value = rooms.value.map((summary) => {
        const lastMessage = summary.lastMessage;
        if (!lastMessage || lastMessage.sender.id !== updatedGuest.id)
          return summary;
        return {
          ...summary,
          lastMessage: { ...lastMessage, sender: updatedGuest },
        };
      });
    }
    const room = roomById(payload.roomId);
    if (payload.reason === "removed") {
      rooms.value = rooms.value.filter(
        (item) => item.room.id !== payload.roomId,
      );
      return;
    }
    if (!room) {
      // 尚未在列表中的房间（他人在其他设备创建后推送）；拉一次列表补齐
      void refresh();
      return;
    }
    room.room = payload.room;
    if (payload.members) {
      room.memberCount = payload.members.length;
    }
    rooms.value = [...rooms.value];
  }

  function applyPresence(payload: {
    roomId: string;
    members: PresenceMemberState[];
  }) {
    presence.value = { ...presence.value, [payload.roomId]: payload.members };
  }

  /** 房间内在线人数（含自己） */
  function onlineCountOf(roomId: string): number {
    return (
      presence.value[roomId]?.filter((member) => member.onlineCount > 0)
        .length ?? 0
    );
  }

  function reset() {
    rooms.value = [];
    presence.value = {};
  }

  return {
    rooms: sortedRooms,
    presence,
    loading,
    totalUnread,
    roomById,
    refresh,
    createRoom,
    join,
    leave,
    fetchMembers,
    upsertFromSync,
    onMessageCreated,
    onOwnReadUpdated,
    applyRoomUpdated,
    applyPresence,
    onlineCountOf,
    reset,
  };
}
