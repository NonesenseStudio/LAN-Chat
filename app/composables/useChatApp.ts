/**
 * 应用编排：把 WebSocket 事件落地到会话/房间/消息状态，并提供启动入口。
 * 事件订阅只在插件中执行一次；页面通过 ensureChatStarted() 启动连接。
 */
import { setRoomsMembershipHook } from "./useRooms";

export function useChatApp() {
  const session = useSession();
  const rooms = useRooms();
  const messages = useMessages();
  const uploads = useUploads();
  const drafts = useRoomDraft();
  const socket = useChatSocket();
  const router = useRouter();

  /** 事件订阅（应用启动时执行一次，重复调用无效） */
  function wire() {
    const wired = useState<boolean>("chat-wired", () => false);
    if (wired.value) return;
    wired.value = true;

    let authRedirectPending = false;
    setUnauthorizedHandler(() => {
      if (authRedirectPending) return;
      authRedirectPending = true;
      const previousInstanceId = session.session.value?.serverInstanceId;
      rooms.reset();
      messages.resetAll();
      uploads.resetAll();
      drafts.clearAll();
      session.invalidate();
      socket.stop();
      void (async () => {
        let reason: "expired" | "restart" = "expired";
        if (previousInstanceId) {
          try {
            const health = await apiFetch<{ serverInstanceId: string }>(
              "/api/health",
            );
            if (health.serverInstanceId !== previousInstanceId)
              reason = "restart";
          } catch {
            // 会话失效提示仍可用；健康接口失败时不推断服务重启。
          }
        }
        if (router.currentRoute.value.path !== "/join") {
          await navigateTo({ path: "/join", query: { reason } });
        }
      })().finally(() => {
        authRedirectPending = false;
      });
    });

    // HTTP 加入/创建/退出房间后重新申请订阅与同步边界
    const sendResume = () => {
      const cursors = rooms.rooms.value.map((summary) => {
        const state = messages.store.value[summary.room.id];
        return { roomId: summary.room.id, lastSeq: state?.syncedSeq ?? 0 };
      });
      socket.send("session.resume", { rooms: cursors });
    };
    setRoomsMembershipHook(sendResume);

    socket.instanceChanged = () => {
      // 服务重启：旧实例的房间、消息、附件引用与草稿全部作废
      rooms.reset();
      messages.resetAll();
      uploads.resetAll();
      drafts.clearAll();
      session.invalidate();
      socket.stop();
      void navigateTo({ path: "/join", query: { reason: "restart" } });
    };

    socket.onOpen(() => {
      // 携带各房间最后连续同步序号申请恢复订阅（7.4 节）
      sendResume();
    });

    socket.on("session.ready", (event) => {
      void (async () => {
        for (const sync of event.payload.rooms) {
          rooms.upsertFromSync(sync.room);
          messages.applySyncState(sync);
          await messages.syncRoom(
            sync.room.id,
            sync.boundarySeq,
            sync.lastReadSeq,
          );
        }
        // 恢复后重发未确认消息（幂等键保证不重复）
        messages.retryAllUnconfirmed();
        // 服务端计算的未读与摘要更权威，做一次校准
        await rooms.refresh().catch(() => {});
        socket.markSynced();
      })();
    });

    socket.on("message.created", (event) => {
      const view = event.payload.message;
      const myId = session.session.value?.guest.id;
      const isOwn = view.message.senderId === myId;
      // 本人消息的权威广播先于 ack 到达时直接收敛待发送状态
      if (isOwn) {
        messages.dropPendingByClientMessageId(view.message.clientMessageId);
      }
      const activeInView = messages.activeRoomId.value === view.message.roomId;
      messages.receive(view, activeInView, (received, active) => {
        rooms.onMessageCreated(
          received.message.roomId,
          received,
          isOwn,
          active,
        );
      });
    });

    socket.on("message.ack", (event) => {
      messages.confirmAck(event.payload.clientMessageId, event.payload.message);
    });

    socket.on("error", (event) => {
      if (event.payload.requestId) {
        messages.failPending(event.payload.requestId, event.payload.message);
      }
    });

    socket.on("room.updated", (event) => {
      rooms.applyRoomUpdated(event.payload);
      const updatedGuest =
        event.payload.reason === "profile" ? event.payload.guest : undefined;
      if (updatedGuest) {
        messages.applyGuestProfile(updatedGuest);
        if (session.session.value?.guest.id === updatedGuest.id) {
          session.session.value = {
            ...session.session.value,
            guest: updatedGuest,
          };
        }
      }
    });

    socket.on("presence.updated", (event) => {
      rooms.applyPresence(event.payload);
    });

    socket.on("room.read.updated", (event) => {
      if (event.payload.guestId !== session.session.value?.guest.id) return;
      messages.applyOwnReadUpdated(
        event.payload.roomId,
        event.payload.lastReadSeq,
      );
      rooms.onOwnReadUpdated(event.payload.roomId);
    });
  }

  /** 会话存在但连接未启动时启动（页面挂载、加入成功后调用） */
  async function ensureStarted() {
    if (!session.session.value) return;
    if (
      socket.status.value === "idle" ||
      socket.status.value === "needs_rejoin"
    ) {
      if (rooms.rooms.value.length === 0) {
        await rooms.refresh().catch(() => {});
      }
      socket.start();
    }
  }

  return { wire, ensureStarted };
}
