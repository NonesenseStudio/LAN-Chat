<script setup lang="ts">
/**
 * 房间列表页：首次访问自动加入默认公共房间。
 * 移动端显示单列房间列表；PC 双栏右侧为未选择房间提示。
 */
const rooms = useRooms();
const session = useSession();
const app = useChatApp();
const router = useRouter();

const autoJoining = ref(false);

onMounted(async () => {
  const view = await session.ensureRestored();
  if (!view) {
    await navigateTo(
      {
        path: "/join",
        query: { redirect: router.currentRoute.value.fullPath },
      },
      { replace: true },
    );
    return;
  }
  await app.ensureStarted();
  await ensureLobby();
});

/** 首次使用没有任何房间时加入公共房间 */
async function ensureLobby() {
  if (rooms.rooms.value.length > 0) return;
  autoJoining.value = true;
  try {
    await rooms.join("lobby");
  } catch {
    // 公共房间不存在或已加入失败时静默，列表页可手动创建/加入
  } finally {
    autoJoining.value = false;
  }
}
</script>

<template>
  <ChatLayout>
    <template #aside>
      <RoomList />
    </template>

    <template #main>
      <div
        class="flex h-full flex-col items-center justify-center gap-3 text-muted"
      >
        <template v-if="autoJoining">
          <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
          <p class="text-sm">正在进入公共房间…</p>
        </template>
        <template v-else>
          <UIcon name="i-lucide-messages-square" class="size-10 text-dimmed" />
          <p class="text-sm">选择一个房间开始聊天</p>
        </template>
      </div>
    </template>
  </ChatLayout>
</template>
