<script setup lang="ts">
/**
 * 应用骨架：PC 双栏（房间栏 + 聊天区），移动端按 768px 断点单页切换。
 * 断点用 CSS 控制，不重建连接、不丢输入状态（计划 3.4 节）。
 * UDashboard* 组件内置 lg(1024px) 断点与计划冲突，这里用 flex + 媒体查询实现。
 */
const route = useRoute();
const socket = useChatSocket();
const messages = useMessages();
const app = useChatApp();

const isRoomRoute = computed(() => route.name === "rooms-roomId");
const syncing = computed(
  () => Object.keys(messages.syncingRoomIds.value).length > 0,
);

onMounted(() => {
  void app.ensureStarted();
});

// 当前房间（未读与已读判定依赖）
watch(
  () => route.params.roomId,
  (roomId) => {
    messages.activeRoomId.value =
      typeof roomId === "string" && roomId ? roomId : null;
    if (typeof roomId === "string" && roomId) {
      messages.markVisibleRead(roomId);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div
    class="chat-layout flex h-dvh w-full overflow-hidden bg-default text-default"
    :class="isRoomRoute ? 'pane-chat' : 'pane-list'"
  >
    <aside class="chat-aside flex h-full min-h-0 flex-col bg-default">
      <slot name="aside" />
    </aside>

    <main class="chat-main flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <!-- 连接与同步状态：仅异常时展示（计划 3.2 节） -->
      <div
        v-if="
          socket.status.value === 'reconnecting' ||
          socket.status.value === 'connecting'
        "
        class="flex items-center justify-center gap-2 border-b border-default bg-warning/10 px-3 py-1.5 text-sm text-warning"
        role="status"
      >
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        {{ socket.statusLabel }}
      </div>
      <div
        v-else-if="syncing"
        class="flex items-center justify-center gap-2 border-b border-default bg-muted px-3 py-1.5 text-sm text-muted"
        role="status"
      >
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        正在同步消息…
      </div>
      <div
        v-else-if="socket.status.value === 'needs_rejoin'"
        class="flex items-center justify-center gap-2 border-b border-default bg-warning/10 px-3 py-1.5 text-sm text-warning"
        role="alert"
      >
        {{ socket.statusLabel }}
        <UButton
          label="重新加入"
          color="warning"
          variant="link"
          size="xs"
          @click="navigateTo('/join?reason=expired')"
        />
      </div>

      <slot name="main" />
    </main>
  </div>
</template>

<style scoped>
/* 布局断点（计划 3.4 节）：768px 起双栏；栏宽 260–300px */
.chat-aside {
  width: 300px;
  flex-shrink: 0;
  border-right: 1px solid var(--ui-border);
}

@media (max-width: 1199px) {
  .chat-aside {
    width: 260px;
  }
}

@media (max-width: 767px) {
  .chat-aside {
    width: 100%;
    border-right: 0;
  }

  /* 单页切换：列表页只显示房间栏，聊天页只显示聊天区 */
  .pane-chat .chat-aside {
    display: none;
  }

  .pane-list .chat-main {
    display: none;
  }
}
</style>
