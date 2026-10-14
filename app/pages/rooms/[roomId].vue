<script setup lang="ts">
/**
 * 聊天页：无身份先转入加入页；非成员自动执行加入流程后进入。
 * 房间不存在时提示并可返回列表。
 */
import type { RoomPublic } from "#shared/types/entities";

const route = useRoute();
const session = useSession();
const rooms = useRooms();
const messages = useMessages();
const app = useChatApp();

const roomId = computed(() => String(route.params.roomId ?? ""));

const room = computed<RoomPublic | null>(
  () => rooms.roomById(roomId.value)?.room ?? null,
);
const isMember = computed(() => rooms.roomById(roomId.value) != null);
const synced = computed(
  () => messages.store.value[roomId.value]?.synced ?? false,
);

const joining = ref(false);
const notFound = ref(false);

onMounted(async () => {
  const view = await session.ensureRestored();
  if (!view) {
    await navigateTo(
      { path: "/join", query: { redirect: route.fullPath } },
      { replace: true },
    );
    return;
  }
  await app.ensureStarted();
  // 列表中已有该房间即视为已加入（列表来自服务端成员关系）
  if (!rooms.roomById(roomId.value)) {
    if (!/^[a-z0-9]{1,64}$/.test(roomId.value)) {
      notFound.value = true;
      return;
    }
    joining.value = true;
    try {
      await rooms.join(roomId.value);
    } catch {
      notFound.value = true;
    } finally {
      joining.value = false;
    }
  }
});

const imagePreview = ref<{ id: string; src: string; filename: string } | null>(
  null,
);
</script>

<template>
  <ChatLayout>
    <template #aside>
      <RoomList />
    </template>

    <template #main>
      <!-- 加入中 / 不存在 -->
      <div
        v-if="joining"
        class="flex h-full flex-col items-center justify-center gap-3 text-muted"
      >
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
        <p class="text-sm">正在加入房间…</p>
      </div>
      <div
        v-else-if="notFound"
        class="flex h-full flex-col items-center justify-center gap-3 text-muted"
      >
        <UIcon name="i-lucide-search-x" class="size-10 text-dimmed" />
        <p class="text-sm">房间不存在或已被清除</p>
        <UButton
          label="返回房间列表"
          color="neutral"
          variant="outline"
          size="sm"
          @click="navigateTo('/')"
        />
      </div>

      <!-- 聊天区 -->
      <template v-else-if="room">
        <ChatHeader :room-id="roomId" :name="room.name" />
        <MessageList :room-id="roomId" @preview="imagePreview = $event" />
        <MessageComposer :room-id="roomId" />

        <UModal
          :open="imagePreview != null"
          :title="imagePreview?.filename ?? '图片预览'"
          :ui="{ content: 'max-w-3xl' }"
          @update:open="(value) => (imagePreview = value ? imagePreview : null)"
        >
          <template #body>
            <img
              v-if="imagePreview"
              :src="imagePreview.src"
              :alt="imagePreview.filename"
              class="max-h-[70vh] w-full rounded-lg object-contain"
            />
          </template>
          <template #footer>
            <div class="flex w-full justify-end gap-2">
              <UButton
                label="下载"
                color="primary"
                variant="soft"
                icon="i-lucide-download"
                :href="
                  imagePreview
                    ? attachmentUrl(imagePreview.id, true)
                    : undefined
                "
                target="_blank"
              />
              <UButton
                label="关闭"
                color="neutral"
                variant="ghost"
                @click="imagePreview = null"
              />
            </div>
          </template>
        </UModal>
      </template>

      <!-- 尚未就绪（等待同步） -->
      <div
        v-else
        class="flex h-full flex-col items-center justify-center gap-3 text-muted"
      >
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
        <p class="text-sm">
          {{ synced ? "选择一个房间开始聊天" : "正在同步消息…" }}
        </p>
      </div>
    </template>
  </ChatLayout>
</template>
