<script setup lang="ts">
/**
 * 输入区：UChatPrompt 承载文本（内置输入法组合保护），业务提交统一走这里。
 * PC 默认 Enter 发送、Shift+Enter 换行；触屏 Enter 换行、按钮发送（计划 3.2/3.3 节）。
 * UChatPrompt 空文本不提交，纯附件发送由自定义“发送”按钮直接调用业务提交。
 */
import type { AttachmentPickerExpose } from "./AttachmentPicker.vue";
import { WS_SERVER_MESSAGE_OVERHEAD_BYTES } from "#shared/constants/limits";
import { PREVIEW_IMAGE_MIMES } from "#shared/constants/mime";

const props = defineProps<{
  roomId: string;
}>();

const socket = useChatSocket();
const messages = useMessages();
const uploads = useUploads();
const drafts = useRoomDraft();
const toast = useToast();

const pickerRef = useTemplateRef<AttachmentPickerExpose>("pickerRef");
const wrapperRef = useTemplateRef<HTMLDivElement>("wrapperRef");

const isTouch = ref(false);
let pointerQuery: MediaQueryList | null = null;
onMounted(() => {
  pointerQuery = window.matchMedia("(pointer: coarse)");
  isTouch.value = pointerQuery.matches;
  pointerQuery.addEventListener("change", onPointerChange);
});
onBeforeUnmount(() => {
  pointerQuery?.removeEventListener("change", onPointerChange);
});
function onPointerChange(event: MediaQueryListEvent) {
  isTouch.value = event.matches;
}

const draft = computed({
  get: () => drafts.draftOf(props.roomId),
  set: (value: string) => drafts.setDraft(props.roomId, value),
});

const canSend = computed(() => socket.status.value === "connected");

/** 按有效传输上限显示占用（完整事件序列化后的 UTF-8 字节数，7.5 节） */
const byteUsage = computed(() => {
  if (!draft.value) return null;
  const cap = socket.capabilities.value?.maxWsMessageBytes;
  if (!cap) return null;
  const envelope = {
    v: 1 as const,
    type: "message.send",
    requestId: "r".repeat(36),
    roomId: props.roomId,
    payload: {
      clientMessageId: "c".repeat(36),
      kind: "text",
      text: draft.value,
    },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
  return { bytes, cap: Math.max(0, cap - WS_SERVER_MESSAGE_OVERHEAD_BYTES) };
});
const showByteUsage = computed(
  () =>
    byteUsage.value != null &&
    byteUsage.value.bytes > byteUsage.value.cap * 0.6,
);
const overLimit = computed(
  () => byteUsage.value != null && byteUsage.value.bytes > byteUsage.value.cap,
);

/** 纯文本 + 就绪附件统一提交；每条消息一个附件 */
function submitBusiness() {
  const ready = pickerRef.value?.takeReady() ?? [];
  const text = draft.value.trim();
  if (!text && ready.length === 0) return;
  if (!canSend.value) return;

  if (text) {
    messages.compose(props.roomId, { kind: "text", text });
    draft.value = "";
  }
  for (const { item } of ready) {
    if (!item.attachment) continue;
    messages.compose(props.roomId, {
      kind: (PREVIEW_IMAGE_MIMES as readonly string[]).includes(item.mime)
        ? "image"
        : "file",
      attachment: item.attachment,
      localAttachment: {
        filename: item.filename,
        size: item.size,
        mime: item.mime,
      },
    });
    uploads.remove(item.localId);
  }
}

function onPromptSubmit() {
  // Enter 提交路径（有文本才会触发）；纯附件由按钮路径处理
  submitBusiness();
}

// 粘贴图片直接上传
function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
  if (files.length === 0) return;
  event.preventDefault();
  for (const file of files) {
    const invalid = uploads.validate(props.roomId, file);
    if (invalid) {
      toast.add({ title: invalid, color: "warning" });
      continue;
    }
    uploads.upload(props.roomId, file);
  }
}

// 拖入文件上传
function onDrop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;
  event.preventDefault();
  for (const file of files) {
    const invalid = uploads.validate(props.roomId, file);
    if (invalid) {
      toast.add({ title: invalid, color: "warning" });
      continue;
    }
    uploads.upload(props.roomId, file);
  }
}
</script>

<template>
  <div
    ref="wrapperRef"
    class="shrink-0 border-t border-default p-3 safe-bottom"
    @paste="onPaste"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <UChatPrompt
      v-model="draft"
      :placeholder="'输入消息'"
      :submit-on-enter="!isTouch"
      :autofocus="!isTouch"
      :ui="{ root: 'rounded-lg' }"
      @submit="onPromptSubmit"
    >
      <template #header>
        <AttachmentPicker ref="pickerRef" :room-id="roomId" class="px-2 pt-2" />
      </template>

      <template #footer>
        <div class="flex w-full items-end justify-between gap-2 px-2 pb-2">
          <div class="flex min-w-0 flex-col">
            <UButton
              label="添加文件"
              icon="i-lucide-paperclip"
              color="neutral"
              variant="ghost"
              size="sm"
              class="min-h-11"
              @click="pickerRef?.pick()"
            />
          </div>

          <div class="flex items-center gap-2">
            <span v-if="showByteUsage" class="text-xs text-dimmed">
              {{ byteUsage?.bytes }}/{{ byteUsage?.cap }} 字节
            </span>
            <UButton
              label="发送"
              icon="i-lucide-send"
              color="primary"
              size="sm"
              class="min-h-11 min-w-11"
              :disabled="!canSend || overLimit"
              @click="submitBusiness"
            />
          </div>
        </div>
      </template>
    </UChatPrompt>

    <p v-if="!canSend" class="mt-1.5 text-xs text-muted" role="status">
      {{ socket.statusLabel || "连接未就绪，暂时无法发送" }}
    </p>
    <p v-else-if="overLimit" class="mt-1.5 text-xs text-error" role="alert">
      消息内容过长，请缩短后发送
    </p>
  </div>
</template>
