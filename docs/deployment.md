# 部署说明

本项目需要 Nitro Node 服务提供网页、HTTP 接口和 WebSocket。IIS 或 Nginx 作为访问入口和反向代理，不能只托管静态文件。

服务使用单个 Node 进程，房间、访客、消息和附件都在进程内存中。停止或重启 Node 会清除全部聊天内容；同一服务不要同时运行多个实例。

## 构建和启动

```bash
pnpm install --frozen-lockfile
pnpm build
node .output/server/index.mjs
```

Node.js 需满足项目声明的版本范围：22.22.3、24.15.0 或更高兼容版本。服务管理器应负责自动启动、崩溃重启和日志轮转。服务默认监听 Nitro 配置的地址和端口；代理部署时绑定回环地址：

```text
NITRO_HOST=127.0.0.1
NITRO_PORT=3000
```

PowerShell 可按本机服务管理方式设置进程环境变量，再启动 Node。不要让代理后的 Node 端口对局域网或公网开放。

## 运行限制

当前默认值用于首轮部署调试，尚未通过 50 连接压力验收。应根据主机内存和实际代理能力设置，并在完整链路上验证：

| 环境变量                              |                         默认值 | 用途                                                 |
| ------------------------------------- | -----------------------------: | ---------------------------------------------------- |
| `LAN_CHAT_MAX_ATTACHMENT_BYTES`       |                         20 MiB | 单个附件文件大小                                     |
| `LAN_CHAT_MAX_TOTAL_ATTACHMENT_BYTES` |                        256 MiB | 内存中附件及上传预留总量                             |
| `LAN_CHAT_MAX_TOTAL_MESSAGE_BYTES`    |                        512 MiB | 服务进程内消息文本的保守内存估算预算                 |
| `LAN_CHAT_MAX_MESSAGES_PER_ROOM`      |                           5000 | 单房间消息数量上限                                   |
| `LAN_CHAT_MAX_ROOMS`                  |                            200 | 房间数量上限，含公共房间                             |
| `LAN_CHAT_MAX_MEMBERS_PER_ROOM`       |                            200 | 单房间成员数上限                                     |
| `LAN_CHAT_MAX_CONNECTIONS`            |                            200 | 全服务 WebSocket 连接数上限                          |
| `LAN_CHAT_MAX_GUESTS`                 |                           1000 | 服务生命周期内创建的访客数上限                       |
| `LAN_CHAT_MAX_WS_MESSAGE_BYTES`       | 未设置（有效上限默认 100 MiB） | WebSocket 应用消息上限覆盖值，不能超过 Node 接收上限 |
| `LAN_CHAT_PROXY_WS_MESSAGE_LIMIT`     |                         未设置 | 已在完整代理链路确认的 WebSocket 消息上限            |

有效 WebSocket 消息上限取 Node 接收上限、代理上限和显式覆盖值中的最小值。代理上限未实测时不要填写猜测值。附件请求体还包含 multipart 表单开销；应用在文件大小上限之外预留 64 KiB 表单空间，代理请求体上限应至少为 20 MiB + 64 KiB。容量报错会说明对应对象，文字消息不使用固定字符数限制。

历史接口按 2 MiB 估算响应大小分页，且最多返回配置的消息条数。单条消息本身可能超过该分页预算，此时单独返回该消息；其大小仍受有效 WebSocket 消息上限约束。

有效限制可通过 `GET /api/capabilities` 查看。`GET /api/health` 仅用于健康检查，同时在服务日志记录进程内存摘要；不要将其日志当作容量验收报告。

## IIS 反向代理

建议使用 IIS 10、WebSocket Protocol、URL Rewrite 和 ARR 3。Node 监听 `127.0.0.1:3000`，IIS 绑定局域网地址或 HTTPS 域名，并将站点请求代理到 Node。

1. 在 Windows Server 功能中启用 WebSocket Protocol。
2. 安装 URL Rewrite 与 ARR，在 IIS 管理器中启用 ARR 代理并打开 Preserve host header。将 `HTTP_X_FORWARDED_PROTO` 加入 URL Rewrite 允许设置的服务器变量。
3. 将 [`deploy/iis/web.config`](../deploy/iis/web.config) 放到 IIS 站点根目录。确认该服务器版本的 ARR 能透传 WebSocket Upgrade，并允许站点请求体至少 21 MiB。
4. 将 Node 作为独立后台服务运行，限制端口只接受本机连接；IIS 应用程序池不负责启动 Node。
5. HTTPS 部署时设置 `LAN_CHAT_TRUST_PROXY=1`。这只在 Node 端口仅由可信本机代理访问时启用，用于依据代理传入的 `X-Forwarded-Proto` 设置 Secure Cookie。
6. 如 IIS 的 WebSocket 消息上限低于 100 MiB，设置 `LAN_CHAT_PROXY_WS_MESSAGE_LIMIT` 为已核实的字节数，并同时确认 IIS 双向传输、空闲超时和连接生命周期。

验证 `GET /api/health`、会话 Cookie 的 Secure 属性、浏览器 WebSocket 的 `101 Switching Protocols`、双向收发、无消息时心跳，以及代理重启后的自动恢复。若 IIS 代理无法稳定保持 WebSocket，当前应用不能以静态文件方式替代服务端。

## Nginx 反向代理

将 [`deploy/nginx/site.conf`](../deploy/nginx/site.conf) 按域名和证书路径调整后纳入 Nginx 的 `http` 配置。配置示例将 HTTPS 请求和 WebSocket 转发到 Node，并将附件请求体上限设为 21 MiB。确认防火墙只开放 Nginx 的公开端口，Node 只监听回环地址。

设置 `LAN_CHAT_TRUST_PROXY=1` 后，Nginx 应覆盖传入的 `X-Forwarded-Proto`，不能原样转发外部用户提供的值。TLS 终止、Cookie Secure、WSS、上传限制、WebSocket 空闲超时和最大消息大小需在同一公开入口上验收。

## 可选环境变量

复制 [`.env.example`](../.env.example) 并按部署环境调整。代理后应明确设置：

```text
LAN_CHAT_TRUST_PROXY=1
LAN_CHAT_MAX_ATTACHMENT_BYTES=20971520
LAN_CHAT_MAX_TOTAL_ATTACHMENT_BYTES=268435456
LAN_CHAT_MAX_TOTAL_MESSAGE_BYTES=536870912
```

如访问域名与 Node 收到的 `Host` 不一致，可用逗号分隔的精确 Origin 配置 `LAN_CHAT_ALLOWED_ORIGINS`，例如 `https://chat.example.com`。只信任自己的站点来源。

## 局域网开发

```bash
pnpm dev:lan
```

用运行主机的局域网 IP 访问开发端口。检查防火墙、无线客户端隔离和地址变化；浏览器不会自动扫描或发现局域网设备。普通 HTTP 局域网访问不加密聊天内容。

## 部署验收状态

本仓库提供 IIS 和 Nginx 示例配置，但没有连接实际 IIS、云端代理或移动设备进行验收。上线前需要分别验证代理 Upgrade、中文与表情消息边界、附件大小边界、连接空闲保持、服务端重启清空和重连补齐。尚未完成这些验证前，不应将建议连接数或延迟目标当作容量承诺。
