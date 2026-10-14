# 局域网聊天

基于 Nuxt 和 Nitro 的临时房间聊天服务。访客使用昵称加入，可收发文字、图片和文件；服务进程重启后，房间、消息和附件都会清除。

## 开发

需要 Node.js `22.22.3`、`24.15.0` 或更高兼容版本，以及 pnpm。

```bash
pnpm install
pnpm dev
```

本机以外的设备需要访问开发服务器时：

```bash
pnpm dev:lan
```

开发服务器会监听所有网卡。使用主机的局域网地址和终端显示的端口访问。

## 生产运行

```bash
pnpm build
node .output/server/index.mjs
```

Nitro 同时提供网页、HTTP 接口和 WebSocket。生产服务应由系统服务管理器启动，并通过 HTTPS 入口代理转发；不要把 `.output/public` 单独复制到 IIS 当作完整应用。

安装、IIS 与 Nginx 代理配置见[部署说明](docs/deployment.md)。

## 当前实现

- 昵称访客会话、公共房间及自建房间
- WebSocket 文字消息、重连、历史分页和未读计数
- 图片与文件上传、预览和下载
- 浅色、深色及跟随系统主题
- 聊天和附件仅保存在服务进程内存中

运行限制可通过环境变量配置。默认附件和消息内存上限是初始容量值，尚未通过压力或部署环境验收；详见[部署说明](docs/deployment.md#运行限制)。
