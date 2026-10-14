<script setup lang="ts">
/**
 * 创建房间 / 加入房间弹窗。
 * 加入模式接受房间 ID 或完整邀请链接（自动提取 /rooms/ 后的 ID）。
 */
const props = defineProps<{
  mode: "create" | "join";
}>();

const open = defineModel<boolean>("open", { required: true });

const rooms = useRooms();

const name = ref("");
const roomRef = ref("");
const submitting = ref(false);
const error = ref("");

watch(open, (value) => {
  if (value) {
    name.value = "";
    roomRef.value = "";
    error.value = "";
  }
});

function extractRoomId(input: string): string {
  const value = input.trim();
  const match = /\/rooms\/([a-z0-9]+)/i.exec(value);
  return match?.[1] ?? value;
}

async function submit() {
  error.value = "";
  submitting.value = true;
  try {
    if (props.mode === "create") {
      const room = await rooms.createRoom(name.value);
      open.value = false;
      await navigateTo(`/rooms/${room.id}`);
    } else {
      const roomId = extractRoomId(roomRef.value);
      await rooms.join(roomId);
      open.value = false;
      await navigateTo(`/rooms/${roomId}`);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败，请重试";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="mode === 'create' ? '创建房间' : '加入房间'"
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <UFormField
          v-if="mode === 'create'"
          label="房间名称"
          name="name"
          :error="error || undefined"
          required
        >
          <UInput v-model="name" maxlength="30" class="w-full" autofocus />
        </UFormField>
        <template v-else>
          <UFormField
            label="房间 ID 或邀请链接"
            name="roomRef"
            :error="error || undefined"
            required
          >
            <UInput
              v-model="roomRef"
              placeholder="粘贴邀请链接或输入房间 ID"
              class="w-full"
              autofocus
            />
          </UFormField>
          <p class="text-xs text-muted">
            也可以通过其他成员分享的链接直接加入房间。
          </p>
        </template>
        <button type="submit" class="hidden" aria-hidden="true" />
      </form>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="open = false"
        />
        <UButton
          :label="mode === 'create' ? '创建房间' : '加入房间'"
          color="primary"
          :loading="submitting"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
