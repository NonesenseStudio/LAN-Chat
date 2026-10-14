/**
 * 展示工具：头像颜色、时间与字节数格式化。
 */
import { AVATAR_ICON_OPTIONS, type AvatarIcon } from "#shared/constants/avatar";

export function avatarIconName(icon: AvatarIcon | undefined): string {
  return (
    AVATAR_ICON_OPTIONS.find((option) => option.value === icon)?.icon ??
    "i-lucide-user"
  );
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** 由 avatarSeed 生成稳定的头像配色，深浅主题分别映射明度 */
export function avatarColors(
  seed: string,
  dark: boolean,
): { backgroundColor: string; color: string } {
  const hue = hashSeed(seed) % 360;
  return dark
    ? { backgroundColor: `hsl(${hue} 42% 34%)`, color: `hsl(${hue} 70% 88%)` }
    : { backgroundColor: `hsl(${hue} 62% 82%)`, color: `hsl(${hue} 55% 26%)` };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 消息时间：当天 HH:mm，跨年带年份 */
export function messageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay) return hm;
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === now.getFullYear()
    ? `${md} ${hm}`
    : `${date.getFullYear()}年${md} ${hm}`;
}

/** 时间分隔标题：今天/昨天/日期 + 时间 */
export function dividerLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.toDateString() === now.toDateString()) return `今天 ${hm}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === now.getFullYear()
    ? `${md} ${hm}`
    : `${date.getFullYear()}年${md} ${hm}`;
}

/** 字节数友好显示 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
