// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },

  devServer: {
    host: "0.0.0.0",
  },

  modules: ["@nuxt/ui"],
  css: ["~/assets/styles/base.css", "~/assets/styles/theme.css"],

  components: [
    // 按计划命名使用组件（ChatLayout、RoomList…），不加目录前缀
    { path: "~/components", pathPrefix: false },
  ],

  // 聊天应用：无搜索引擎收录需求，浏览器状态与主题初始化更简单
  ssr: false,

  ui: {
    // 局域网离线使用：不请求公网字体元数据，使用系统字体
    fonts: false,
  },

  // 主题偏好 light | dark | system；classSuffix 由 @nuxt/ui 强制为 ''
  colorMode: {
    preference: "system",
  },

  // 图标本地打包：未安装集合时 @nuxt/icon 会回退公网 API，离线不可用
  icon: {
    serverBundle: { collections: ["lucide"] },
    clientBundle: { scan: true, sizeLimitKb: 0 },
  },

  nitro: {
    preset: "node-server",
    experimental: { websocket: true },
  },

  typescript: {
    strict: true,
  },
});
