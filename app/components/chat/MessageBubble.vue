<script setup lang="ts">
/**
 * 消息气泡：UChatMessage 展示适配层（id / role= user / parts），
 * 左右由 side + 发送者控制；昵称、头像、附件、时间与状态通过插槽扩展（计划 5 节）。
 */
import type { MessageView } from "#shared/types/entities";
import type { PendingMessage } from "~/composables/useMessages";

const props = defineProps<{
  view?: MessageView;
  pending?: PendingMessage;
  own: boolean;
  showNickname: boolean;
}>();

const emit = defineEmits<{
  preview: [payload: { id: string; src: string; filename: string }];
}>();

const { resolvedDark } = useTheme();

const message = computed(() => props.view?.message);
const sender = computed(() => props.view?.sender);
const attachment = computed(() => props.view?.attachment ?? null);

/** 待发送消息的展示数据 */
const pendingAttachment = computed(() => {
  if (!props.pending?.localAttachment) return null;
  return props.pending.localAttachment;
});
const pendingImageSrc = computed(() => {
  if (props.pending?.kind !== "image" || !props.pending.attachmentId)
    return undefined;
  return attachmentUrl(props.pending.attachmentId);
});

const text = computed(() => message.value?.text ?? props.pending?.text ?? "");
const createdAt = computed(
  () => message.value?.createdAt ?? props.pending?.createdAt ?? "",
);
const statusLine = computed(() => {
  if (!props.own || !props.pending) return "";
  if (props.pending.status === "sending") return "发送中…";
  if (props.pending.status === "unconfirmed") return "发送状态未确认";
  return props.pending.error ? `发送失败：${props.pending.error}` : "发送失败";
});

const avatar = computed(() => {
  if (!sender.value) return undefined;
  return {
    icon: avatarIconName(sender.value.avatarIcon),
    style: avatarColors(sender.value.avatarSeed, resolvedDark.value),
  };
});

function openImagePreview() {
  if (attachment.value) {
    emit("preview", {
      id: attachment.value.id,
      src: attachmentUrl(attachment.value.id),
      filename: attachment.value.filename,
    });
  }
}

const messages = useMessages();

function retry() {
  if (props.pending) messages.retry(props.pending);
}
</script>

<template>
  <div class="w-full">
    <UChatMessage
      :id="message?.id ?? pending?.clientMessageId ?? 'pending'"
      role="user"
      :side="own ? 'right' : 'left'"
      :variant="own ? 'solid' : 'soft'"
      :color="own ? 'primary' : 'neutral'"
      :parts="[{ type: 'text', text }]"
      :class="pending ? 'opacity-80' : ''"
    >
      <template v-if="!own && avatar" #leading>
        <UAvatar :icon="avatar.icon" :style="avatar.style" size="md" />
      </template>

      <template v-if="showNickname || own" #header>
        <div class="flex items-center gap-2 text-xs text-dimmed">
          <span v-if="!own && showNickname && sender">{{
            sender.nickname
          }}</span>
          <span>{{ messageTime(createdAt) }}</span>
        </div>
      </template>

      <template #content>
        <!-- 附件区：图片缩略图可预览，文件为卡片 -->
        <div
          v-if="attachment || pendingAttachment || pendingImageSrc"
          class="mb-1.5 flex flex-col gap-1.5"
        >
          <!-- 上传中的本地图片预览 -->
          <img
            v-if="pendingAttachment?.objectUrl || pendingImageSrc"
            :src="pendingAttachment?.objectUrl ?? pendingImageSrc"
            :alt="pendingAttachment?.filename ?? '图片'"
            class="max-h-64 rounded-lg border border-inverted/20 object-contain"
          />
          <div
            v-else-if="pendingAttachment && pending?.kind !== 'image'"
            class="chat-file-card"
          >
            <UIcon name="i-lucide-file" class="size-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate text-xs">{{
              pendingAttachment.filename
            }}</span>
            <span class="text-xs opacity-70">{{
              formatBytes(pendingAttachment.size)
            }}</span>
          </div>

          <!-- 已存储的图片 / 文件 -->
          <template v-else-if="attachment">
            <img
              v-if="message?.kind === 'image'"
              :src="attachmentUrl(attachment.id)"
              :alt="attachment.filename"
              loading="lazy"
              class="max-h-64 cursor-zoom-in rounded-lg border border-inverted/20 object-contain"
              @click="openImagePreview()"
            />
            <a
              v-else
              :href="attachmentUrl(attachment.id, true)"
              class="chat-file-card"
              :download="attachment.filename"
            >
              <UIcon name="i-lucide-file-down" class="size-4 shrink-0" />
              <span class="min-w-0 flex-1 truncate text-xs">{{
                attachment.filename
              }}</span>
              <span class="text-xs opacity-70">{{
                formatBytes(attachment.size)
              }}</span>
            </a>
          </template>
        </div>

        <MessageContent v-if="text" :text="text" />
      </template>
    </UChatMessage>

    <!-- 发送状态行（仅自己的待发送消息） -->
    <div
      v-if="statusLine"
      class="mt-1 flex items-center justify-end gap-1 text-xs"
      :class="pending?.status === 'failed' ? 'text-error' : 'text-dimmed'"
    >
      <span>{{ statusLine }}</span>
      <UButton
        v-if="pending?.status === 'failed'"
        label="重新发送"
        color="error"
        variant="link"
        size="xs"
        :padded="false"
        @click="retry"
      />
      <UButton
        v-else-if="pending?.status === 'unconfirmed'"
        label="重新发送"
        color="neutral"
        variant="link"
        size="xs"
        :padded="false"
        @click="retry"
      />
    </div>
  </div>
</template>

<style scoped>
.chat-file-card {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 100%;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  background: color-mix(in srgb, currentColor 8%, transparent);
  border-radius: 0.5rem;
  padding: 0.375rem 0.625rem;
  color: inherit;
}
</style>
