<script setup lang="ts">
/**
 * 房间成员抽屉：成员列表与在线状态（右侧滑出，窄窗口不挤占三栏）。
 */
import type { MemberPublic } from "#shared/types/entities";

const props = defineProps<{
  roomId: string;
}>();

const open = defineModel<boolean>("open", { required: true });

const rooms = useRooms();
const session = useSession();
const socket = useChatSocket();
const { resolvedDark } = useTheme();

const members = ref<MemberPublic[]>([]);
const loading = ref(false);
const loadError = ref(false);

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    const data = await rooms.fetchMembers(props.roomId);
    members.value = data.members;
  } catch {
    members.value = [];
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

const stopProfileWatch = socket.on("room.updated", (event) => {
  if (
    event.payload.roomId === props.roomId &&
    event.payload.reason === "profile" &&
    open.value
  ) {
    void load();
  }
});
onBeforeUnmount(stopProfileWatch);

watch(open, (value) => {
  if (value) void load();
});

// 在线状态变化时刷新快照
watch(
  () => rooms.presence.value[props.roomId],
  () => {
    if (open.value) void load();
  },
  { deep: true },
);
</script>

<template>
  <USlideover v-model:open="open" title="房间成员" :side="'right'">
    <template #body>
      <div
        v-if="loading && members.length === 0"
        class="flex justify-center py-8"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-6 animate-spin text-muted"
        />
      </div>
      <ul v-else class="flex flex-col gap-1">
        <li
          v-for="member in members"
          :key="member.guest.id"
          class="flex items-center gap-3 rounded-lg px-2 py-2"
        >
          <UAvatar
            :icon="avatarIconName(member.guest.avatarIcon)"
            :style="avatarColors(member.guest.avatarSeed, resolvedDark)"
            size="sm"
          />
          <span class="min-w-0 flex-1 truncate text-sm text-default">
            {{ member.guest.nickname }}
            <span
              v-if="member.guest.id === session.session.value?.guest.id"
              class="text-muted"
              >（我）</span
            >
          </span>
          <span
            class="flex items-center gap-1.5 text-xs"
            :class="member.onlineCount > 0 ? 'text-success' : 'text-dimmed'"
          >
            <span
              class="size-1.5 rounded-full"
              :class="member.onlineCount > 0 ? 'bg-success' : 'bg-accented'"
            />
            {{ member.onlineCount > 0 ? "在线" : "离线" }}
          </span>
        </li>
      </ul>
      <p
        v-if="!loading && members.length === 0"
        class="py-8 text-center text-sm text-muted"
      >
        {{ loadError ? "暂时无法加载成员信息" : "房间内暂无成员" }}
      </p>
    </template>
  </USlideover>
</template>
