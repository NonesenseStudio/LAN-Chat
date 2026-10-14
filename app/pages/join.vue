<script setup lang="ts">
/**
 * 加入页：设置昵称进入聊天。
 * 有房间链接时保留目标（?redirect=/rooms/:id），完成身份创建后继续加入。
 * 服务重启或身份失效时给出明确提示。
 */
const session = useSession();
const socket = useChatSocket();
const rooms = useRooms();
const route = useRoute();

const nickname = ref("");
const submitting = ref(false);
const error = ref("");

const restartNotice = computed(() => route.query.reason === "restart");
const expiredNotice = computed(() => route.query.reason === "expired");

onMounted(async () => {
  nickname.value = session.rememberedNickname.value;
  // 已有有效身份时直接进入目标页
  const view = await session.ensureRestored();
  if (view) {
    const redirect =
      typeof route.query.redirect === "string" ? route.query.redirect : "/";
    await navigateTo(redirect, { replace: true });
  }
});

async function submit() {
  error.value = "";
  submitting.value = true;
  try {
    await session.join(nickname.value.trim());
    // 进入应用：拉取房间并启动连接
    await rooms.refresh().catch(() => {});
    socket.start();
    const redirect =
      typeof route.query.redirect === "string" ? route.query.redirect : "/";
    await navigateTo(redirect, { replace: true });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加入失败，请重试";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    class="flex h-dvh flex-col items-center justify-center bg-default px-4 text-default"
  >
    <div class="w-full max-w-sm">
      <div class="mb-8 text-center">
        <div
          class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-primary/10"
        >
          <UIcon name="i-lucide-message-circle" class="size-6 text-primary" />
        </div>
        <h1 class="text-xl font-semibold">局域网聊天</h1>
        <p class="mt-1 text-sm text-muted">临时房间，无需注册</p>
      </div>

      <UAlert
        v-if="restartNotice"
        class="mb-4"
        color="warning"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="服务已重新启动，请重新加入"
      />
      <UAlert
        v-else-if="expiredNotice"
        class="mb-4"
        color="warning"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="身份已失效，请重新加入"
      />

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <UFormField
          label="昵称"
          name="nickname"
          :error="error || undefined"
          required
        >
          <UInput
            v-model="nickname"
            maxlength="30"
            autofocus
            class="w-full"
            size="lg"
          />
        </UFormField>

        <UButton
          type="submit"
          label="进入聊天"
          color="primary"
          size="lg"
          block
          :loading="submitting"
          :disabled="nickname.trim().length === 0"
        />
      </form>

      <p class="mt-6 text-center text-xs text-dimmed">
        服务关闭后聊天记录和文件将被清除
      </p>
    </div>
  </div>
</template>
