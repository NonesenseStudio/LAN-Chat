<script setup lang="ts">
/**
 * 消息列表：滚动容器 + 时间分隔 + 历史向上翻页（保持位置）。
 * 仅接近底部时自动滚动；阅读历史时显示“有新消息”入口（计划 3.4 节）。
 * 接近底部且页面可见时推进已读。
 */
import type { MessageView } from "#shared/types/entities";
import type { ChatListItem } from "~/composables/useMessages";

const props = defineProps<{
  roomId: string;
}>();

const emit = defineEmits<{
  preview: [payload: { id: string; src: string; filename: string }];
}>();

const messages = useMessages();
const session = useSession();

const scrollRef = useTemplateRef<HTMLDivElement>("scrollRef");
const nearBottom = ref(true);
const hasUnseenNew = ref(false);
const loadingOlder = ref(false);

const state = computed(() => messages.store.value[props.roomId]);
const views = computed<MessageView[]>(() => state.value?.views ?? []);
const pendingItems = computed(() => messages.pendingOf(props.roomId));
const myGuestId = computed(() => session.session.value?.guest.id ?? null);

const items = computed<ChatListItem[]>(() =>
  buildChatList(views.value, pendingItems.value, myGuestId.value),
);

const isEmpty = computed(
  () =>
    state.value?.synced &&
    views.value.length === 0 &&
    pendingItems.value.length === 0,
);

interface RenderItem {
  key: string;
  kind: "divider" | "item";
  label?: string;
  item?: ChatListItem;
  /** 相邻同成员消息合并：隐藏头像与昵称 */
  compact?: boolean;
}

/** 时间分隔（间隔 >5 分钟）+ 相邻同发送者紧凑排列 */
const renderItems = computed<RenderItem[]>(() => {
  const result: RenderItem[] = [];
  let lastTime = 0;
  let lastSender: string | null = null;
  for (const item of items.value) {
    const createdAt =
      item.type === "message"
        ? item.view.message.createdAt
        : item.item.createdAt;
    const senderId =
      item.type === "message"
        ? item.view.message.senderId
        : (myGuestId.value ?? "");
    const time = Date.parse(createdAt);
    if (!lastTime || time - lastTime > 5 * 60 * 1000) {
      result.push({
        key: `d-${createdAt}`,
        kind: "divider",
        label: dividerLabel(createdAt),
      });
      lastSender = null;
    }
    const compact = senderId === lastSender;
    result.push({ key: item.key, kind: "item", item, compact });
    lastSender = senderId;
    lastTime = time;
  }
  return result;
});

function isNearBottom(): boolean {
  const el = scrollRef.value;
  if (!el) return false;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

messages.setNearBottomChecker(() => isNearBottom());

function scrollToBottom(smooth = false) {
  const el = scrollRef.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  hasUnseenNew.value = false;
}

function onScroll() {
  nearBottom.value = isNearBottom();
  if (nearBottom.value) {
    hasUnseenNew.value = false;
    messages.markVisibleRead(props.roomId);
  }
  // 顶部加载更早消息
  const el = scrollRef.value;
  if (
    el &&
    el.scrollTop < 60 &&
    state.value?.hasMoreBefore &&
    !loadingOlder.value
  ) {
    void loadOlder();
  }
}

async function loadOlder() {
  const el = scrollRef.value;
  if (!el) return;
  loadingOlder.value = true;
  const previousHeight = el.scrollHeight;
  try {
    await messages.loadOlder(props.roomId);
    await nextTick();
    // 保持当前阅读位置
    el.scrollTop += el.scrollHeight - previousHeight;
  } finally {
    loadingOlder.value = false;
  }
}

// 新消息到达：接近底部则跟随，否则显示“有新消息”
watch(
  () => items.value[items.value.length - 1]?.key,
  (next, previous) => {
    if (!next || next === previous) return;
    if (nearBottom.value) {
      void nextTick(() => scrollToBottom());
    } else {
      hasUnseenNew.value = true;
    }
  },
);

// 首次同步完成：定位到底部
watch(
  () => state.value?.synced,
  (synced) => {
    if (synced) void nextTick(() => scrollToBottom(false));
  },
  { immediate: true },
);

// 页面可见性恢复时推进已读
function onVisibilityChange() {
  if (document.visibilityState === "visible" && nearBottom.value) {
    messages.markVisibleRead(props.roomId);
  }
}
onMounted(() => {
  document.addEventListener("visibilitychange", onVisibilityChange);
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange);
});

const previewBubble = (payload: {
  id: string;
  src: string;
  filename: string;
}) => emit("preview", payload);
</script>

<template>
  <div class="relative min-h-0 flex-1">
    <div
      ref="scrollRef"
      class="h-full overflow-y-auto overscroll-contain px-2 py-4"
      @scroll.passive="onScroll"
    >
      <!-- 向上加载中 -->
      <div v-if="loadingOlder" class="flex justify-center py-2">
        <UIcon
          name="i-lucide-loader-circle"
          class="size-5 animate-spin text-muted"
        />
      </div>
      <div v-else-if="state?.hasMoreBefore" class="flex justify-center py-2">
        <UButton
          label="加载更早消息"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="loadOlder"
        />
      </div>

      <!-- 空状态 -->
      <div
        v-if="isEmpty"
        class="flex h-full flex-col items-center justify-center gap-2 text-muted"
      >
        <UIcon name="i-lucide-message-circle" class="size-8 text-dimmed" />
        <p class="text-sm">还没有消息</p>
      </div>

      <UChatMessages
        v-else
        :messages="[]"
        :auto-scroll="false"
        :should-scroll-to-bottom="false"
        class="mx-auto w-full max-w-240"
      >
        <template #default>
          <template v-for="render in renderItems" :key="render.key">
            <div
              v-if="render.kind === 'divider'"
              class="flex items-center gap-3 py-2"
            >
              <USeparator class="flex-1" />
              <span
                class="text-xs"
                :style="{ color: 'var(--chat-divider-text)' }"
                >{{ render.label }}</span
              >
              <USeparator class="flex-1" />
            </div>
            <MessageBubble
              v-else-if="render.item"
              :view="
                render.item.type === 'message' ? render.item.view : undefined
              "
              :pending="
                render.item.type === 'pending' ? render.item.item : undefined
              "
              :own="render.item.own"
              :show-nickname="!render.compact"
              class="py-0.5"
              @preview="previewBubble"
            />
          </template>
        </template>
      </UChatMessages>
    </div>

    <!-- 有新消息入口：阅读历史时出现 -->
    <Transition name="fade">
      <UButton
        v-if="hasUnseenNew || !nearBottom"
        label="有新消息"
        icon="i-lucide-arrow-down"
        color="neutral"
        variant="outline"
        size="sm"
        class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
        @click="scrollToBottom(true)"
      />
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
