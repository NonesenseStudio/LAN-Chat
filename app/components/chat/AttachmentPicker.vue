<script setup lang="ts">
/**
 * 附件选择与上传进度：按钮选择（支持多选）、图片/文件上传、失败重试、取消。
 * 上传完成的附件随下一条消息发送（协议每条消息携带一个附件）。
 */
import type { UploadItem } from "~/composables/useUploads";
import { PREVIEW_IMAGE_MIMES } from "#shared/constants/mime";

export interface AttachmentPickerExpose {
  /** 打开文件选择 */
  pick: () => void;
  /** 取走已上传就绪的附件（发送时调用） */
  takeReady: () => Array<{ item: UploadItem }>;
}

const props = defineProps<{
  roomId: string;
}>();

const uploads = useUploads();
const toast = useToast();

const inputRef = useTemplateRef<HTMLInputElement>("inputRef");

const roomUploads = computed(() =>
  uploads.items.value.filter((item) => item.roomId === props.roomId),
);

function isImage(item: { mime: string }): boolean {
  return (PREVIEW_IMAGE_MIMES as readonly string[]).includes(item.mime);
}

function pick() {
  inputRef.value?.click();
}

function onFilesChosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  for (const file of files) {
    const invalid = uploads.validate(props.roomId, file);
    if (invalid) {
      toast.add({ title: invalid, color: "warning" });
      continue;
    }
    uploads.upload(props.roomId, file);
  }
}

/** 供 Composer 发送时取走已就绪附件 */
function takeReady(): Array<{ item: UploadItem }> {
  const ready = roomUploads.value.filter(
    (item) => item.status === "done" && item.attachment,
  );
  return ready.map((item) => ({ item }));
}

function removeItem(localId: string) {
  uploads.remove(localId);
}

function retryItem(item: UploadItem) {
  uploads.upload(props.roomId, item.file, item.localId);
}

defineExpose<AttachmentPickerExpose>({ pick, takeReady });
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- 附件队列 -->
    <ul v-if="roomUploads.length" class="flex flex-col gap-1.5">
      <li
        v-for="item in roomUploads"
        :key="item.localId"
        class="flex items-center gap-2 rounded-lg border border-default bg-elevated/50 px-2 py-1.5"
      >
        <img
          v-if="isImage(item) && item.objectUrl"
          :src="item.objectUrl"
          :alt="item.filename"
          class="size-8 rounded object-cover"
        />
        <UIcon v-else name="i-lucide-file" class="size-4 text-muted" />

        <span class="min-w-0 flex-1 truncate text-xs text-default">{{
          item.filename
        }}</span>

        <UProgress
          v-if="item.status === 'uploading'"
          :model-value="item.progress"
          size="xs"
          class="w-16"
          :ui="{ base: 'h-1' }"
        />
        <span v-else-if="item.status === 'done'" class="text-xs text-success"
          >可发送</span
        >
        <template v-else-if="item.status === 'failed'">
          <span class="text-xs text-error">上传失败</span>
          <UButton
            label="重新上传"
            color="error"
            variant="link"
            size="xs"
            :padded="false"
            @click="retryItem(item)"
          />
        </template>

        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="justify-center cursor-pointer"
          aria-label="移除附件"
          @click="removeItem(item.localId)"
        />
      </li>
    </ul>

    <input
      ref="inputRef"
      type="file"
      multiple
      class="hidden"
      @change="onFilesChosen"
    />
  </div>
</template>
