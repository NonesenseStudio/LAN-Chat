<script setup lang="ts">
/**
 * 房间标题栏：返回（移动端）、房间名、在线人数、成员与邀请入口。
 * 仅网络异常时展示连接提示（由 ChatLayout 统一渲染，这里不重复）。
 */
import { renderSVG } from "uqr";

const props = defineProps<{
  roomId: string;
  name: string;
}>();

const rooms = useRooms();
const messages = useMessages();
const toast = useToast();

// 窄视口显示返回入口（跟随布局断点）
const isMobile = ref(false);
let mediaQuery: MediaQueryList | null = null;
onMounted(() => {
  mediaQuery = window.matchMedia("(max-width: 767px)");
  isMobile.value = mediaQuery.matches;
  mediaQuery.addEventListener("change", onMediaChange);
});
onBeforeUnmount(() => {
  mediaQuery?.removeEventListener("change", onMediaChange);
});
function onMediaChange(event: MediaQueryListEvent) {
  isMobile.value = event.matches;
}

const showMembers = ref(false);
const showInvite = ref(false);

const onlineCount = computed(() => rooms.onlineCountOf(props.roomId));
// 成员数以房间列表为准（room.updated 保持最新），消息同步状态仅作回退
const memberCount = computed(
  () =>
    rooms.roomById(props.roomId)?.memberCount ??
    messages.store.value[props.roomId]?.memberCount ??
    0,
);

const inviteLink = computed(() => {
  if (import.meta.server) return "";
  return `${window.location.origin}/rooms/${props.roomId}`;
});

const qrSvg = computed(() => {
  if (!showInvite.value) return "";
  // 轻量本地生成，不请求公网（离线可用）
  return renderSVG(inviteLink.value, {
    border: 2,
    blackColor: "#000000",
    whiteColor: "#ffffff",
  });
});

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    toast.add({ title: "邀请链接已复制", color: "success" });
  } catch {
    toast.add({ title: "复制失败，请手动复制", color: "warning" });
  }
}
</script>

<template>
  <header
    class="flex h-14 shrink-0 items-center gap-2 border-b border-default px-3"
  >
    <UTooltip v-if="isMobile" text="返回房间列表">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        class="min-h-11 min-w-11 justify-center cursor-pointer"
        aria-label="返回房间列表"
        @click="navigateTo('/')"
      />
    </UTooltip>

    <h1 class="min-w-0 flex-1 truncate text-lg font-semibold text-default">
      {{ name }}
    </h1>

    <span class="max-[399px]:sr-only shrink-0 text-xs text-muted">
      {{ onlineCount }} 人在线 · {{ memberCount }} 名成员
    </span>

    <UTooltip text="邀请成员">
      <UButton
        icon="i-lucide-qr-code"
        color="neutral"
        variant="ghost"
        class="min-h-11 min-w-11 justify-center cursor-pointer"
        aria-label="邀请成员"
        @click="showInvite = true"
      />
    </UTooltip>
    <UTooltip text="房间成员">
      <UButton
        icon="i-lucide-users"
        color="neutral"
        variant="ghost"
        class="min-h-11 min-w-11 justify-center cursor-pointer"
        aria-label="房间成员"
        @click="showMembers = true"
      />
    </UTooltip>

    <RoomMembers v-model:open="showMembers" :room-id="roomId" />

    <UModal v-model:open="showInvite" title="邀请成员">
      <template #body>
        <div class="flex flex-col items-center gap-4">
          <!-- eslint-disable-next-line vue/no-v-html — 本地 uqr 生成的 SVG -->
          <div
            v-if="qrSvg"
            class="rounded-lg bg-white p-2 [&_svg]:block [&_svg]:size-52"
            v-html="qrSvg"
          />
          <p class="text-xs text-muted">手机扫码或复制链接打开同一房间</p>
          <UButtonGroup size="sm" class="w-full">
            <UInput
              :model-value="inviteLink"
              readonly
              class="flex-1"
              :ui="{ base: 'w-full' }"
            />
            <UButton
              label="复制链接"
              icon="i-lucide-copy"
              color="primary"
              variant="soft"
              @click="copyInvite"
            />
          </UButtonGroup>
        </div>
      </template>
    </UModal>
  </header>
</template>
