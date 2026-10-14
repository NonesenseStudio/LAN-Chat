/**
 * 主题偏好入口：仅封装 Nuxt UI 集成的 useColorMode。
 * 偏好持久化、系统主题监听与首次加载防闪烁均由 @nuxtjs/color-mode 处理。
 */
export type ThemePreference = "light" | "dark" | "system";

export const THEME_OPTIONS: Array<{ label: string; value: ThemePreference }> = [
  { label: "浅色", value: "light" },
  { label: "深色", value: "dark" },
  { label: "跟随系统", value: "system" },
];

export function useTheme() {
  const colorMode = useColorMode();

  const preference = computed({
    get: () => colorMode.preference as ThemePreference,
    set: (value: ThemePreference) => {
      colorMode.preference = value;
    },
  });

  /** 当前实际生效的主题（system 解析后） */
  const resolvedDark = computed(() => colorMode.value === "dark");

  return { preference, resolvedDark };
}
