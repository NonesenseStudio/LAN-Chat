export const AVATAR_ICON_OPTIONS = [
  { value: "user", label: "用户", icon: "i-lucide-user" },
  { value: "cat", label: "猫咪", icon: "i-lucide-cat" },
  { value: "dog", label: "狗狗", icon: "i-lucide-dog" },
  { value: "smile", label: "笑脸", icon: "i-lucide-smile" },
  { value: "ghost", label: "幽灵", icon: "i-lucide-ghost" },
  { value: "bot", label: "机器人", icon: "i-lucide-bot" },
  { value: "leaf", label: "叶子", icon: "i-lucide-leaf" },
  { value: "music", label: "音乐", icon: "i-lucide-music" },
  { value: "gamepad-2", label: "游戏手柄", icon: "i-lucide-gamepad-2" },
  { value: "rocket", label: "火箭", icon: "i-lucide-rocket" },
  { value: "star", label: "星星", icon: "i-lucide-star" },
  { value: "coffee", label: "咖啡", icon: "i-lucide-coffee" },
] as const;

export type AvatarIcon = (typeof AVATAR_ICON_OPTIONS)[number]["value"];

export const DEFAULT_AVATAR_ICON: AvatarIcon = "user";
