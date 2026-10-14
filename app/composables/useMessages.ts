/**
 * 消息状态：按房间的消息集合、待确认发送、历史分页、断线补齐与已读推进。
 * 排序与去重以服务端 seq/id 为准；待发送消息单独排在末尾，ack 后替换为权威数据。
 */
import type {
  AttachmentPublic,
  GuestPublic,
  MessageView,
} from "#shared/types/entities";
import type { MessageKind, RoomSyncState } from "#shared/types/protocol";
import type { RoomMessagesResponse } from "#shared/types/api";
import { ACK_TIMEOUT_MS, DEFAULT_PAGE_LIMIT } from "#shared/constants/limits";

export type PendingStatus = "sending" | "unconfirmed" | "failed";

export interface PendingMessage {
  clientMessageId: string;
  roomId: string;
  kind: MessageKind;
  text?: string;
  attachmentId?: string;
  /** 本地待发送附件元数据（图片缩略图 / 文件卡片展示用） */
  localAttachment?: {
    filename: string;
    size: number;
    mime: string;
    objectUrl?: string;
  };
  status: PendingStatus;
  /** 失败原因（面向用户中文文案） */
  error?: string;
  createdAt: string;
  timer?: ReturnType<typeof setTimeout>;
}

export interface RoomMessageState {
  views: MessageView[];
  /** 已确认连续同步到的序号；补拉与实时推送据此判断缺口 */
  syncedSeq: number;
  hasMoreBefore: boolean;
  loadingBefore: boolean;
  /** 首次同步（进房补拉）是否完成 */
  synced: boolean;
  lastReadSeq: number;
  memberCount: number;
}

/** 贴近底部判定：由 MessageList 注册，跨实例共享（接收路径在编排层实例上运行） */
let nearBottomChecker: () => boolean = () => false;

export function useMessages() {
  const store = useState<Record<string, RoomMessageState>>(
    "room-messages",
    () => ({}),
  );

  const pending = useState<PendingMessage[]>("pending-messages", () => []);
  const syncingRoomIds = useState<Record<string, boolean>>(
    "room-syncing",
    () => ({}),
  );
  /** 当前正在查看的房间（页面挂载时设置；用于未读与已读判定） */
  const activeRoomId = useState<string | null>("active-room", () => null);

  const socket = useChatSocket();
  const session = useSession();

  function stateOf(roomId: string): RoomMessageState {
    let state = store.value[roomId];
    if (!state) {
      state = {
        views: [],
        syncedSeq: 0,
        hasMoreBefore: false,
        loadingBefore: false,
        synced: false,
        lastReadSeq: 0,
        memberCount: 0,
      };
      store.value = { ...store.value, [roomId]: state };
    }
    return state;
  }

  function viewsOf(roomId: string): MessageView[] {
    return store.value[roomId]?.views ?? [];
  }

  function applyGuestProfile(guest: GuestPublic) {
    for (const state of Object.values(store.value)) {
      if (!state.views.some((view) => view.sender.id === guest.id)) continue;
      state.views = state.views.map((view) =>
        view.sender.id === guest.id ? { ...view, sender: guest } : view,
      );
    }
  }

  function pendingOf(roomId: string): PendingMessage[] {
    return pending.value.filter((item) => item.roomId === roomId);
  }

  /** 按序号合并一条权威消息；重复 id 丢弃 */
  function mergeView(roomId: string, view: MessageView) {
    const state = stateOf(roomId);
    if (state.views.some((item) => item.message.id === view.message.id)) return;
    const index = state.views.findIndex(
      (item) => item.message.seq > view.message.seq,
    );
    if (index === -1) {
      state.views = [...state.views, view];
    } else {
      state.views = [
        ...state.views.slice(0, index),
        view,
        ...state.views.slice(index),
      ];
    }
    // 连续序号推进；出现缺口时由补拉收敛
    if (view.message.seq === state.syncedSeq + 1) {
      state.syncedSeq = view.message.seq;
    }
  }

  function activeRoomVisible(): boolean {
    return (
      import.meta.client &&
      document.visibilityState === "visible" &&
      activeRoomId.value != null
    );
  }

  // ---- 同步（首次进入 / 重连补齐） ----

  /** session.ready 后对每个已加入房间执行：先进房取最近一页，重连按缺口补拉 */
  async function syncRoom(
    roomId: string,
    boundarySeq: number,
    lastReadSeq: number,
  ) {
    const state = stateOf(roomId);
    state.lastReadSeq = Math.max(state.lastReadSeq, lastReadSeq);
    syncingRoomIds.value = { ...syncingRoomIds.value, [roomId]: true };
    try {
      if (!state.synced) {
        // 首次只取最近一页
        const page = await apiFetch<RoomMessagesResponse>(
          `/api/rooms/${roomId}/messages`,
          {
            query: { limit: DEFAULT_PAGE_LIMIT },
          },
        );
        for (const view of page.messages) mergeView(roomId, view);
        state.hasMoreBefore = page.hasMoreBefore;
        state.syncedSeq = Math.max(state.syncedSeq, page.latestSeq);
        state.synced = true;
      } else if (state.syncedSeq < boundarySeq) {
        // 断线期间错过的部分：从已连续位置补拉到同步边界
        await fillAfter(roomId, boundarySeq);
      }
    } catch (error) {
      console.error("[messages] 同步失败", roomId, error);
    } finally {
      const next = { ...syncingRoomIds.value };
      delete next[roomId];
      syncingRoomIds.value = next;
    }
  }

  /** afterSeq/throughSeq 分页补齐到边界；推送与补拉按 id 去重后自然合并 */
  async function fillAfter(roomId: string, boundarySeq: number) {
    const state = stateOf(roomId);
    while (state.syncedSeq < boundarySeq) {
      const page = await apiFetch<RoomMessagesResponse>(
        `/api/rooms/${roomId}/messages`,
        {
          query: {
            afterSeq: state.syncedSeq,
            throughSeq: boundarySeq,
            limit: DEFAULT_PAGE_LIMIT,
          },
        },
      );
      for (const view of page.messages) mergeView(roomId, view);
      if (page.messages.length === 0) {
        // 边界内无缺失（边界即最新消息本身），直接对齐
        state.syncedSeq = boundarySeq;
        break;
      }
      state.syncedSeq = Math.max(
        state.syncedSeq,
        page.messages[page.messages.length - 1]!.message.seq,
      );
      if (!page.hasMoreAfter) {
        state.syncedSeq = Math.max(
          state.syncedSeq,
          Math.min(boundarySeq, latestKnownSeq(roomId)),
        );
        break;
      }
    }
  }

  function latestKnownSeq(roomId: string): number {
    const views = store.value[roomId]?.views;
    return views?.length ? views[views.length - 1]!.message.seq : 0;
  }

  /** 实时推送发现缺口时按需补拉（去抖，一次循环拉平） */
  const gapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function scheduleGapFill(roomId: string, fromSeq: number) {
    if (gapTimers.has(roomId)) return;
    gapTimers.set(
      roomId,
      setTimeout(async () => {
        gapTimers.delete(roomId);
        const state = stateOf(roomId);
        try {
          const before = state.syncedSeq;
          await fillAfter(roomId, Math.max(before, latestKnownSeq(roomId)));
        } catch (error) {
          console.error("[messages] 缺口补拉失败", roomId, error);
        }
        void fromSeq;
      }, 300),
    );
  }

  // ---- 历史向上翻页 ----

  async function loadOlder(roomId: string): Promise<void> {
    const state = stateOf(roomId);
    if (!state.hasMoreBefore || state.loadingBefore || state.views.length === 0)
      return;
    state.loadingBefore = true;
    try {
      const oldestSeq = state.views[0]!.message.seq;
      const page = await apiFetch<RoomMessagesResponse>(
        `/api/rooms/${roomId}/messages`,
        {
          query: { beforeSeq: oldestSeq, limit: DEFAULT_PAGE_LIMIT },
        },
      );
      const existing = new Set(state.views.map((view) => view.message.id));
      const fresh = page.messages.filter(
        (view) => !existing.has(view.message.id),
      );
      state.views = [...fresh, ...state.views];
      state.hasMoreBefore = page.hasMoreBefore;
    } finally {
      state.loadingBefore = false;
    }
  }

  // ---- 接收 ----

  /** message.created：合并消息、更新连续序号、判定是否推进已读 */
  function receive(
    view: MessageView,
    activeInView: boolean,
    onNewForRooms: (view: MessageView, activeInView: boolean) => void,
  ) {
    const roomId = view.message.roomId;
    mergeView(roomId, view);
    const state = stateOf(roomId);
    const nextSeq = view.message.seq;
    if (nextSeq > state.syncedSeq + 1) {
      scheduleGapFill(roomId, state.syncedSeq);
    }
    const isOwn = view.message.senderId === session.session.value?.guest.id;
    const shouldMarkRead =
      activeInView && activeRoomVisible() && isNearBottom();
    onNewForRooms(view, activeInView && (isOwn || shouldMarkRead));
    if (shouldMarkRead) {
      markRead(roomId, nextSeq);
    }
  }

  /** 滚动位置由 MessageList 注册（贴近底部时新消息自动已读）；按标签页共享 */
  function setNearBottomChecker(checker: () => boolean) {
    nearBottomChecker = checker;
  }
  function isNearBottom(): boolean {
    return nearBottomChecker();
  }

  // ---- 已读 ----

  function markRead(roomId: string, seq: number) {
    const state = stateOf(roomId);
    if (seq <= state.lastReadSeq) return;
    state.lastReadSeq = seq;
    socket.send("room.read", { seq }, { roomId });
  }

  /** 供 MessageList 在滚动/可见性变化时主动推进已读 */
  function markVisibleRead(roomId: string) {
    if (!activeRoomVisible()) return;
    const state = store.value[roomId];
    const latest = state?.views[state.views.length - 1];
    if (latest) markRead(roomId, latest.message.seq);
  }

  function applyOwnReadUpdated(roomId: string, lastReadSeq: number) {
    const state = stateOf(roomId);
    state.lastReadSeq = Math.max(state.lastReadSeq, lastReadSeq);
  }

  // ---- 发送 ----

  function newClientMessageId(): string {
    if (import.meta.client && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `cm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /** 发送一条消息：先入待确认列表再走 WebSocket；重试沿用同一 clientMessageId */
  function compose(
    roomId: string,
    input: {
      kind: MessageKind;
      text?: string;
      attachment?: AttachmentPublic;
      /** 本地预览数据（图片缩略图 / 文件卡片），确认后由权威消息替换 */
      localAttachment?: {
        filename: string;
        size: number;
        mime: string;
        objectUrl?: string;
      };
    },
  ): PendingMessage {
    const clientMessageId = newClientMessageId();
    const item: PendingMessage = {
      clientMessageId,
      roomId,
      kind: input.kind,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.attachment ? { attachmentId: input.attachment.id } : {}),
      ...(input.localAttachment
        ? { localAttachment: input.localAttachment }
        : {}),
      status: "sending",
      createdAt: new Date().toISOString(),
    };
    pending.value = [...pending.value, item];
    dispatchPending(item);
    return item;
  }

  /** 实际发出；超时转“发送状态未确认”，失败标“发送失败” */
  function dispatchPending(item: PendingMessage) {
    item.status = "sending";
    item.error = undefined;
    pending.value = [...pending.value];
    const result = socket.send(
      "message.send",
      {
        clientMessageId: item.clientMessageId,
        kind: item.kind,
        ...(item.text !== undefined ? { text: item.text } : {}),
        ...(item.attachmentId ? { attachmentId: item.attachmentId } : {}),
      },
      { requestId: item.clientMessageId, roomId: item.roomId },
    );
    if (!result.ok) {
      item.status = "failed";
      item.error = result.message;
      pending.value = [...pending.value];
      return;
    }
    armAckTimer(item);
  }

  function armAckTimer(item: PendingMessage) {
    clearAckTimer(item);
    item.timer = setTimeout(() => {
      if (item.status === "sending") {
        item.status = "unconfirmed";
        pending.value = [...pending.value];
      }
    }, ACK_TIMEOUT_MS);
    pending.value = [...pending.value];
  }

  function clearAckTimer(item: PendingMessage) {
    if (item.timer) {
      clearTimeout(item.timer);
      item.timer = undefined;
    }
  }

  /** 手动重发（重新发送按钮） */
  function retry(item: PendingMessage) {
    dispatchPending(item);
  }

  /** 重连恢复后自动重发全部未确认消息（同一 clientMessageId 幂等） */
  function retryAllUnconfirmed() {
    for (const item of pending.value) {
      if (item.status === "sending" || item.status === "unconfirmed") {
        dispatchPending(item);
      }
    }
  }

  /** message.ack：用权威消息替换待发送状态 */
  function confirmAck(clientMessageId: string, view: MessageView) {
    const item = pending.value.find(
      (candidate) => candidate.clientMessageId === clientMessageId,
    );
    if (item) {
      clearAckTimer(item);
      pending.value = pending.value.filter((candidate) => candidate !== item);
    }
    mergeView(view.message.roomId, view);
  }

  /** 服务端拒绝或本人消息广播到达：移除对应待发送 */
  function failPending(clientMessageId: string, message: string) {
    const item = pending.value.find(
      (candidate) => candidate.clientMessageId === clientMessageId,
    );
    if (!item) return;
    clearAckTimer(item);
    item.status = "failed";
    item.error = message;
    pending.value = [...pending.value];
  }

  /** 本人同 clientMessageId 的权威广播先于 ack 到达时直接收敛 */
  function dropPendingByClientMessageId(clientMessageId: string) {
    const item = pending.value.find(
      (candidate) => candidate.clientMessageId === clientMessageId,
    );
    if (item) {
      clearAckTimer(item);
      pending.value = pending.value.filter((candidate) => candidate !== item);
    }
  }

  function applySyncState(sync: RoomSyncState) {
    const state = stateOf(sync.room.id);
    state.memberCount = sync.memberCount;
    state.lastReadSeq = Math.max(state.lastReadSeq, sync.lastReadSeq);
  }

  /** 服务重启：全部消息、待发送与同步进度作废 */
  function resetAll() {
    for (const item of pending.value) clearAckTimer(item);
    pending.value = [];
    store.value = {};
    syncingRoomIds.value = {};
    activeRoomId.value = null;
  }

  return {
    store,
    pending,
    syncingRoomIds,
    activeRoomId,
    viewsOf,
    applyGuestProfile,
    pendingOf,
    syncRoom,
    loadOlder,
    receive,
    setNearBottomChecker,
    markRead,
    markVisibleRead,
    applyOwnReadUpdated,
    applySyncState,
    compose,
    retry,
    retryAllUnconfirmed,
    confirmAck,
    failPending,
    dropPendingByClientMessageId,
    resetAll,
    stateOf,
  };
}

/** 供组件渲染的统一条目：权威消息或待发送消息 */
export type ChatListItem =
  | { type: "message"; key: string; view: MessageView; own: boolean }
  | { type: "pending"; key: string; item: PendingMessage; own: true };

export function buildChatList(
  views: MessageView[],
  pendingItems: PendingMessage[],
  myGuestId: string | null,
): ChatListItem[] {
  const items: ChatListItem[] = views.map((view) => ({
    type: "message" as const,
    key: view.message.id,
    view,
    own: view.message.senderId === myGuestId,
  }));
  const pendingList: ChatListItem[] = pendingItems.map((item) => ({
    type: "pending" as const,
    key: item.clientMessageId,
    item,
    own: true,
  }));
  return [...items, ...pendingList];
}
