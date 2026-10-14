/**
 * 客户端启动插件：注册事件编排（一次性）并尽早恢复会话。
 * 连接启动由页面在会话确认后调用 ensureChatStarted()。
 */
export default defineNuxtPlugin(() => {
  const app = useChatApp();
  app.wire();
  void useSession().ensureRestored();
});
