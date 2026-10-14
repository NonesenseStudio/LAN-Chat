/**
 * 页面共享的 WebSocket 连接管理器（docs/implementation-plan.md 7.1 节）。
 * 每个浏览器标签页一个应用级连接：建立、心跳、退避重连、实例变化检测与事件分发。
 * 消息状态业务不在这里；其他模块通过 on()/onOpen() 订阅服务端事件与连接恢复时机。
 */
import type {
  ChatSocketStatus,
  ServerCapabilities,
  SessionResumePayload,
  WsServerEvent,
  WsServerEventMap,
} from "#shared/types/protocol";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  RECONNECT_BASE_DELAYS_MS,
  RECONNECT_MAX_DELAY_MS,
  WS_SERVER_MESSAGE_OVERHEAD_BYTES,
} from "#shared/constants/limits";

type ServerEventHandler<K extends keyof WsServerEventMap> = (
  event: WsServerEvent & { type: K; payload: WsServerEventMap[K] },
) => void;

export interface SocketSendResult {
  ok: boolean;
  /** 超过有效传输上限时为 MESSAGE_TOO_LARGE */
  code?: string;
  message?: string;
}

const STATUS_LABELS: Record<ChatSocketStatus, string> = {
  idle: "",
  connecting: "正在连接…",
  connected: "",
  reconnecting: "连接已断开，正在重连",
  needs_rejoin: "身份已失效，请重新加入",
};

class ChatSocket {
  status = ref<ChatSocketStatus>("idle");
  /** 服务端发布的能力参数；session.ready 后可用 */
  capabilities = ref<ServerCapabilities | null>(null);
  /** 最近一次服务端结构化错误（面向用户展示用） */
  lastError = ref<{ code: string; message: string } | null>(null);

  private ws: WebSocket | null = null;
  private handlers = new Map<
    keyof WsServerEventMap,
    Set<ServerEventHandler<never>>
  >();
  private openHandlers = new Set<() => void>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastServerActivityAt = 0;
  private reconnectAttempts = 0;
  private instanceId = "";
  private stopped = true;
  /** 发送队列：连接就绪前暂存（已按字节校验），恢复后按序发出 */
  private pendingOutgoing: Array<{
    type: string;
    roomId?: string;
    json: string;
  }> = [];
  private lastMessageRequestId = "";

  constructor() {
    if (import.meta.client) {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.wake();
      });
      window.addEventListener("online", () => this.wake());
    }
  }

  get statusLabel(): string {
    return STATUS_LABELS[this.status.value];
  }

  get connected(): boolean {
    return this.status.value === "connected";
  }

  on<K extends keyof WsServerEventMap>(
    type: K,
    handler: ServerEventHandler<K>,
  ) {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as ServerEventHandler<never>);
    return () => {
      set?.delete(handler as ServerEventHandler<never>);
    };
  }

  /** 连接建立后回调（resume 在这里发出）；重复注册只在首次生效由调用方保证 */
  onOpen(handler: () => void) {
    this.openHandlers.add(handler);
  }

  /** 启动连接（幂等）；由应用编排层在会话就绪后调用 */
  start() {
    if (!import.meta.client || !this.stopped) return;
    this.stopped = false;
    this.open();
  }

  /** 停止重连并清理计时器（主动退出、身份失效时） */
  stop() {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "client stop");
    this.status.value = "idle";
    this.pendingOutgoing = [];
    this.reconnectAttempts = 0;
  }

  /**
   * 发送客户端事件；序列化后按 TextEncoder 字节数对照有效上限（7.5 节）。
   * 未就绪时入队，恢复后按序发出；超限直接拒绝并返回原因。
   */
  send(type: "session.resume", payload: SessionResumePayload): SocketSendResult;
  send(
    type: "message.send",
    payload: import("#shared/types/protocol").MessageSendPayload,
    options: { requestId: string; roomId: string },
  ): SocketSendResult;
  send(
    type: "room.read",
    payload: import("#shared/types/protocol").RoomReadPayload,
    options: { roomId: string },
  ): SocketSendResult;
  send(type: "ping", payload: { t?: number }): SocketSendResult;
  send(
    type: string,
    payload: unknown,
    options?: { requestId?: string; roomId?: string },
  ): SocketSendResult {
    const envelope = {
      v: 1 as const,
      type,
      ...(options?.requestId ? { requestId: options.requestId } : {}),
      ...(options?.roomId ? { roomId: options.roomId } : {}),
      payload,
    };
    const json = JSON.stringify(envelope);
    const bytes = new TextEncoder().encode(json).length;
    const cap = this.capabilities.value?.maxWsMessageBytes;
    const reserve =
      type === "message.send" ? WS_SERVER_MESSAGE_OVERHEAD_BYTES : 0;
    if (cap !== undefined && bytes + reserve > cap) {
      const limit = Math.max(0, cap - reserve);
      return {
        ok: false,
        code: "MESSAGE_TOO_LARGE",
        message: `消息内容过长，请缩短后发送（${bytes} 字节，上限 ${limit} 字节）`,
      };
    }
    if (type === "session.resume") {
      this.pendingOutgoing = this.pendingOutgoing.filter(
        (item) => item.type !== "session.resume",
      );
    } else if (type === "room.read" && options?.roomId) {
      this.pendingOutgoing = this.pendingOutgoing.filter(
        (item) =>
          !(item.type === "room.read" && item.roomId === options.roomId),
      );
    }
    if (type === "message.send" && options?.requestId)
      this.lastMessageRequestId = options.requestId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(json);
      return { ok: true };
    }
    if (type === "message.send") {
      return { ok: false, code: "NETWORK", message: "连接未就绪，消息未发送" };
    }
    this.pendingOutgoing.push({
      type,
      ...(options?.roomId ? { roomId: options.roomId } : {}),
      json,
    });
    return { ok: true };
  }

  /** 立即检查连接：页面回前台、网络恢复时调用 */
  wake() {
    if (this.stopped) return;
    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      Date.now() - this.lastServerActivityAt > HEARTBEAT_TIMEOUT_MS
    ) {
      this.reconnectNow();
      return;
    }
    if (
      !this.ws ||
      this.ws.readyState === WebSocket.CLOSED ||
      this.ws.readyState === WebSocket.CLOSING
    ) {
      this.reconnectAttempts = 0;
      this.open();
    }
  }

  private open() {
    this.clearTimers();
    this.status.value =
      this.reconnectAttempts > 0 ? "reconnecting" : "connecting";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.lastServerActivityAt = Date.now();
      this.startHeartbeat();
      for (const handler of this.openHandlers) {
        try {
          handler();
        } catch (error) {
          console.error("[socket] open 处理失败", error);
        }
      }
    };
    ws.onmessage = (event) => {
      this.lastServerActivityAt = Date.now();
      this.dispatch(event.data);
    };
    ws.onclose = (event) => {
      // 已被替换（心跳超时主动重连）的旧连接不作处理
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      if (this.stopped) return;
      if (event.code === 4001) {
        // 会话在服务端已不存在：需要重新加入，不无限重试
        this.status.value = "needs_rejoin";
        void apiFetch("/api/session").catch(() => {});
        return;
      }
      if (event.code === 1009 && this.lastMessageRequestId) {
        this.dispatch({
          v: 1,
          type: "error",
          payload: {
            code: "MESSAGE_TOO_LARGE",
            message: "消息内容过长，请缩短后发送",
            requestId: this.lastMessageRequestId,
          },
        });
        this.lastMessageRequestId = "";
      }
      if (event.code === 1006) {
        // 浏览器不公开升级响应状态；用同源会话接口区分离线与身份失效。
        void apiFetch("/api/session").catch(() => {});
      }
      this.reconnectAttempts++;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // close 事件随后到达，统一在 onclose 处理
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const base =
      RECONNECT_BASE_DELAYS_MS[
        Math.min(
          this.reconnectAttempts - 1,
          RECONNECT_BASE_DELAYS_MS.length - 1,
        )
      ] ?? RECONNECT_BASE_DELAYS_MS[RECONNECT_BASE_DELAYS_MS.length - 1]!;
    const extraDoublings = Math.max(
      0,
      this.reconnectAttempts - RECONNECT_BASE_DELAYS_MS.length,
    );
    const growingBase = Math.min(
      base * 2 ** extraDoublings,
      RECONNECT_MAX_DELAY_MS,
    );
    // 指数退避 + 随机抖动，封顶 30s
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      growingBase * (0.7 + Math.random() * 0.6),
    );
    this.status.value = "reconnecting";
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private reconnectNow() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    ws?.close(4000, "heartbeat timeout");
    if (!this.stopped) this.open();
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastServerActivityAt > HEARTBEAT_TIMEOUT_MS) {
        this.reconnectNow();
        return;
      }
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send("ping", { t: Date.now() });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers() {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private dispatch(raw: unknown) {
    let event: WsServerEvent;
    try {
      event = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }
    if (!event || event.v !== 1 || typeof event.type !== "string") return;

    if (event.type === "session.ready") {
      const handled = this.handleReady(
        event as WsServerEvent & { type: "session.ready" },
      );
      if (!handled) return;
    }
    if (event.type === "error") {
      this.lastError.value = {
        code: event.payload.code,
        message: event.payload.message,
      };
    }
    if (
      event.type === "message.ack" &&
      event.requestId === this.lastMessageRequestId
    ) {
      this.lastMessageRequestId = "";
    }
    const set = this.handlers.get(event.type as keyof WsServerEventMap);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as (e: WsServerEvent) => void)(event);
      } catch (error) {
        console.error("[socket] 事件处理失败", event.type, error);
      }
    }
  }

  /** 返回 false 表示实例变化（实例切换编排已接管，不再分发给业务订阅） */
  private handleReady(
    event: WsServerEvent & { type: "session.ready" },
  ): boolean {
    this.capabilities.value = event.payload.capabilities;
    const previous = this.instanceId;
    const next = event.payload.serverInstanceId;
    this.instanceId = next;
    if (previous && previous !== next) {
      // 服务重启：旧实例的一切状态作废，由编排层清理并提示重新加入
      this.status.value = "needs_rejoin";
      this.instanceChanged?.(next);
      return false;
    }
    this.status.value = "connected";
    this.reconnectAttempts = 0;
    return true;
  }

  /** 实例变化回调，由应用编排层注册 */
  instanceChanged: ((newInstance: string) => void) | null = null;

  /** resume 已由编排层发出且同步完成后调用；冲刷排队中的发送 */
  markSynced() {
    this.flushPending();
  }

  private flushPending() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const queued = this.pendingOutgoing;
    this.pendingOutgoing = [];
    for (const item of queued) {
      try {
        this.ws.send(item.json);
      } catch {
        // 连接再次断开时由后续重试覆盖
      }
    }
  }
}

let socket: ChatSocket | null = null;

/** 页面共享的连接管理器（每标签页单例） */
export function useChatSocket(): ChatSocket {
  if (!socket) {
    socket = new ChatSocket();
  }
  return socket;
}

export type { ChatSocketStatus };
