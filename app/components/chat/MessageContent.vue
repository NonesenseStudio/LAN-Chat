<script setup lang="ts">
/**
 * 文本消息内容：纯文本渲染（不解析 HTML/Markdown）、可选中复制。
 * 超长文本折叠展示，展开后保留完整内容（计划 7.5 节）。
 */
const props = defineProps<{
  text: string;
}>();

const COLLAPSE_LENGTH = 800;

const expanded = ref(false);
const isLong = computed(() => props.text.length > COLLAPSE_LENGTH);
const displayText = computed(() => {
  if (!isLong.value || expanded.value) return props.text;
  return `${props.text.slice(0, COLLAPSE_LENGTH)}…`;
});
</script>

<template>
  <div class="whitespace-pre-wrap break-words text-sm leading-relaxed">
    {{ displayText }}
    <UButton
      v-if="isLong"
      :label="expanded ? '收起' : '展开'"
      color="neutral"
      variant="link"
      size="xs"
      class="ms-1 align-baseline"
      :padded="false"
      @click="expanded = !expanded"
    />
  </div>
</template>
