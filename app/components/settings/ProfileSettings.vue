<script setup lang="ts">
/**
 * 个人设置：昵称、头像图标与主题。
 * 资料经服务端校验并广播到所在房间；主题由 useColorMode 管理。
 */
import {
  AVATAR_ICON_OPTIONS,
  DEFAULT_AVATAR_ICON,
  type AvatarIcon,
} from "#shared/constants/avatar";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const session = useSession();
const rooms = useRooms();
const messages = useMessages();
const uploads = useUploads();
const drafts = useRoomDraft();
const { preference } = useTheme();
const toast = useToast();

const nickname = ref("");
const avatarIcon = ref<AvatarIcon>(DEFAULT_AVATAR_ICON);
const submitting = ref(false);
const error = ref("");

watch(
  () => props.open,
  (value) => {
    if (value) {
      nickname.value = session.session.value?.guest.nickname ?? "";
      avatarIcon.value =
        session.session.value?.guest.avatarIcon ?? DEFAULT_AVATAR_ICON;
      error.value = "";
    }
  },
);

async function submit() {
  error.value = "";
  submitting.value = true;
  try {
    await session.updateProfile(nickname.value, avatarIcon.value);
    toast.add({ title: "资料已更新", color: "success" });
    emit("update:open", false);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "保存失败，请重试";
  } finally {
    submitting.value = false;
  }
}

async function leaveChat() {
  await session.leave();
  useChatSocket().stop();
  rooms.reset();
  messages.resetAll();
  uploads.resetAll();
  drafts.clearAll();
  await navigateTo("/join");
}
</script>

<template>
  <UModal
    :open="props.open"
    title="个人设置"
    @update:open="(value) => emit('update:open', value)"
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <UFormField
          label="昵称"
          name="nickname"
          :error="error || undefined"
          required
        >
          <UInput v-model="nickname" maxlength="30" class="w-full" />
        </UFormField>

        <UFormField label="头像图标">
          <div
            class="grid grid-cols-6 gap-2"
            role="group"
            aria-label="选择头像图标"
          >
            <UTooltip
              v-for="option in AVATAR_ICON_OPTIONS"
              :key="option.value"
              :text="option.label"
            >
              <UButton
                type="button"
                :icon="option.icon"
                :color="avatarIcon === option.value ? 'primary' : 'neutral'"
                :variant="avatarIcon === option.value ? 'soft' : 'ghost'"
                :aria-label="`选择${option.label}头像`"
                :aria-pressed="avatarIcon === option.value"
                class="size-10 justify-center cursor-pointer"
                @click="avatarIcon = option.value"
              />
            </UTooltip>
          </div>
        </UFormField>

        <UFormField
          label="主题"
          description="选择“跟随系统”后，界面会随系统外观切换"
        >
          <USelect
            v-model="preference"
            :items="THEME_OPTIONS"
            value-key="value"
            placeholder="选择主题"
            class="w-full"
          />
        </UFormField>

        <button type="submit" class="hidden" aria-hidden="true" />
      </form>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between">
        <UButton
          label="退出聊天"
          color="error"
          variant="ghost"
          size="sm"
          @click="leaveChat"
        />
        <UButton
          label="保存"
          color="primary"
          :loading="submitting"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
