/**
 * 访客会话状态：加入、身份恢复、资料更新与退出。
 * 服务端签发 HttpOnly Cookie；浏览器仅保存昵称便于下次填入（首版本地偏好）。
 */
import type { SessionView } from "#shared/types/api";
import type { AvatarIcon } from "#shared/constants/avatar";

const NICKNAME_STORAGE_KEY = "lanchat:nickname";

/** 每个标签页只允许一次进行中的恢复请求 */
let restoreInFlight: Promise<SessionView | null> | null = null;

export function useSession() {
  const session = useState<SessionView | null>("session", () => null);
  const restoring = useState<boolean>("session-restoring", () => false);

  /** 上次使用的昵称（仅本浏览器，便于回填加入页） */
  const rememberedNickname = computed(() => {
    if (import.meta.server) return "";
    return localStorage.getItem(NICKNAME_STORAGE_KEY) ?? "";
  });

  function rememberNickname(nickname: string) {
    if (import.meta.server) return;
    try {
      localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
    } catch {
      // 隐私模式等场景忽略
    }
  }

  /** 启动时用现有 Cookie 恢复身份；无身份或已失效返回 null */
  async function restore(): Promise<SessionView | null> {
    restoring.value = true;
    try {
      session.value = await apiFetch<SessionView>("/api/session");
      return session.value;
    } catch {
      session.value = null;
      return null;
    } finally {
      restoring.value = false;
    }
  }

  /** 幂等恢复：并发调用共享同一次请求；页面据此判断是否需要转入加入页 */
  async function ensureRestored(): Promise<SessionView | null> {
    if (session.value) return session.value;
    if (!restoreInFlight) {
      restoreInFlight = restore().finally(() => {
        restoreInFlight = null;
      });
    }
    return restoreInFlight;
  }

  /** 设置昵称并创建身份；已有有效身份时服务端幂等返回原身份 */
  async function join(nickname: string): Promise<SessionView> {
    const view = await apiFetch<SessionView>("/api/session", {
      method: "POST",
      body: { nickname },
    });
    session.value = view;
    rememberNickname(nickname);
    return view;
  }

  async function updateProfile(
    nickname: string,
    avatarIcon: AvatarIcon,
  ): Promise<void> {
    const { guest } = await apiFetch<{ guest: SessionView["guest"] }>(
      "/api/profile",
      {
        method: "PATCH",
        body: { nickname, avatarIcon },
      },
    );
    if (session.value) {
      session.value = { ...session.value, guest };
    }
    rememberNickname(nickname);
  }

  /** 主动退出：清空服务端会话与本页身份状态 */
  async function leave(): Promise<void> {
    try {
      await apiFetch("/api/session", { method: "DELETE" });
    } catch {
      // 会话可能已失效，忽略
    }
    session.value = null;
  }

  /** 会话被服务端判定失效（401）时本地同步清理 */
  function invalidate() {
    session.value = null;
  }

  return {
    session,
    restoring,
    rememberedNickname,
    restore,
    ensureRestored,
    join,
    updateProfile,
    leave,
    invalidate,
  };
}
