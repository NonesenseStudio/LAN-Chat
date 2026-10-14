<script setup lang="ts">
/**
 * 房间列表：搜索、未读徽标、最后一条摘要、成员入口与设置入口。
 */
import type { RoomSummary } from "#shared/types/entities";
import type { DropdownMenuItem } from "@nuxt/ui";

const router = useRouter();
const rooms = useRooms();
const session = useSession();
const { resolvedDark } = useTheme();
const toast = useToast();

const search = ref("");
const showCreate = ref(false);
const showJoin = ref(false);
const showSettings = ref(false);
const activeRoomId = computed(
  () => router.currentRoute.value.params.roomId ?? null,
);

const filtered = computed<RoomSummary[]>(() => {
  const keyword = search.value.trim().toLowerCase();
  if (!keyword) return rooms.rooms.value;
  return rooms.rooms.value.filter((room) =>
    room.room.name.toLowerCase().includes(keyword),
  );
});

function summaryOf(room: RoomSummary): string {
  const last = room.lastMessage;
  if (!last) return "";
  const me = session.session.value?.guest.id;
  const prefix =
    last.message.senderId === me ? "我：" : `${last.sender.nickname}：`;
  const body =
    last.message.kind === "image"
      ? "图片"
      : last.message.kind === "file"
        ? `文件：${last.attachment?.filename ?? ""}`
        : (last.message.text ?? "");
  const text = body.length > 30 ? `${body.slice(0, 30)}…` : body;
  return `${prefix}${text}`;
}

function timeOf(room: RoomSummary): string {
  const iso = room.lastMessage?.message.createdAt ?? room.lastActivityAt;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function roomActions(room: RoomSummary): DropdownMenuItem[][] {
  return [
    [
      {
        label: "退出房间",
        icon: "i-lucide-log-out",
        color: "error",
        onSelect: () => void leaveRoom(room.room.id),
      },
    ],
  ];
}

async function leaveRoom(roomId: string) {
  try {
    await rooms.leave(roomId);
    toast.add({ title: "已退出房间", color: "success" });
    if (String(router.currentRoute.value.params.roomId ?? "") === roomId) {
      await navigateTo("/");
    }
  } catch (error) {
    toast.add({
      title: error instanceof Error ? error.message : "退出房间失败，请重试",
      color: "error",
    });
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- 顶部：搜索与房间动作 -->
    <div class="flex flex-col gap-2 border-b border-default p-3">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="搜索已加入的房间"
        size="md"
        :ui="{ root: 'w-full' }"
      />
      <div class="flex gap-2">
        <UButton
          label="创建房间"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          class="min-h-11 flex-1"
          @click="showCreate = true"
        />
        <UButton
          label="加入房间"
          icon="i-lucide-log-in"
          color="neutral"
          variant="outline"
          size="sm"
          class="min-h-11 flex-1"
          @click="showJoin = true"
        />
      </div>
    </div>

    <!-- 房间列表 -->
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
      <p
        v-if="filtered.length === 0"
        class="px-3 py-6 text-center text-sm text-muted"
      >
        {{ search.trim() ? "没有匹配的房间" : "还没有加入任何房间" }}
      </p>
      <ul class="flex flex-col gap-1">
        <li v-for="room in filtered" :key="room.room.id">
          <div
            class="flex items-center gap-1 rounded-lg pe-1 transition-colors hover:bg-elevated/60"
            :class="room.room.id === activeRoomId ? 'bg-primary/10' : ''"
          >
            <NuxtLink
              :to="`/rooms/${room.room.id}`"
              class="block min-w-0 flex-1 rounded-lg px-3 py-2.5"
            >
              <div class="flex items-baseline gap-2">
                <span
                  class="min-w-0 flex-1 truncate text-sm font-medium text-default"
                  >{{ room.room.name }}</span
                >
                <span class="shrink-0 text-xs text-dimmed">{{
                  timeOf(room)
                }}</span>
              </div>
              <div class="mt-0.5 flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate text-xs text-muted">{{
                  summaryOf(room)
                }}</span>
                <UBadge
                  v-if="room.unreadCount > 0"
                  :label="
                    room.unreadCount > 99 ? '99+' : String(room.unreadCount)
                  "
                  color="primary"
                  size="sm"
                  class="shrink-0"
                />
              </div>
            </NuxtLink>
            <UDropdownMenu :items="roomActions(room)">
              <UButton
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="ghost"
                size="sm"
                class="min-h-11 min-w-11 justify-center cursor-pointer"
                :aria-label="`${room.room.name}房间操作`"
              />
            </UDropdownMenu>
          </div>
        </li>
      </ul>
    </div>

    <!-- 底部：个人入口 -->
    <div class="flex items-center gap-2 border-t border-default p-3">
      <UAvatar
        v-if="session.session.value"
        :icon="avatarIconName(session.session.value.guest.avatarIcon)"
        :style="
          avatarColors(session.session.value.guest.avatarSeed, resolvedDark)
        "
        size="sm"
      />
      <span class="min-w-0 flex-1 truncate text-sm text-default">
        {{ session.session.value?.guest.nickname ?? "未加入" }}
      </span>
      <UTooltip text="个人设置">
        <UButton
          icon="i-lucide-settings"
          color="neutral"
          variant="ghost"
          size="sm"
          class="min-h-11 min-w-11 justify-center cursor-pointer"
          aria-label="个人设置"
          @click="showSettings = true"
        />
      </UTooltip>
    </div>

    <RoomForm v-model:open="showCreate" mode="create" />
    <RoomForm v-model:open="showJoin" mode="join" />
    <ProfileSettings v-model:open="showSettings" />
  </div>
</template>
