/**
 * 房间输入草稿：仅页面内存（路由切换保留，刷新即清空）。
 */
export function useRoomDraft() {
  const drafts = useState<Record<string, string>>("room-drafts", () => ({}));

  function draftOf(roomId: string): string {
    return drafts.value[roomId] ?? "";
  }

  function setDraft(roomId: string, value: string) {
    if (value) {
      drafts.value = { ...drafts.value, [roomId]: value };
    } else {
      const next = { ...drafts.value };
      delete next[roomId];
      drafts.value = next;
    }
  }

  function clearAll() {
    drafts.value = {};
  }

  return { draftOf, setDraft, clearAll };
}
