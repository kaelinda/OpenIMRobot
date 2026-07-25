# OpenIMRobot

统一封装飞书、钉钉、企业微信、Telegram、QQ 等平台机器人接入的 TypeScript 框架，避免在多 Agent 协作场景中为每个平台重复造轮子。

调研依据见 [`docs/im-bot-api-research.md`](docs/im-bot-api-research.md)。

## 安装

```bash
npm install
npm run build
```

## 架构

详细设计与历次架构评审的修订记录见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

- `BaseBotAdapter`：所有平台适配器的基类，统一 `sendText` / 可选 `sendMarkdown` 接口、`capabilities`
  能力声明，以及基于 `EventEmitter` 的 `message` 事件（长连接/长轮询型适配器通过 `start()` / `stop()`
  管理生命周期）。
- `AdapterCapabilities`：每个 Adapter 显式声明 `contextualReply`/`proactiveSend`/`interactiveCards`/
  `markdown`/`receivesMessages`，业务/Agent 层据此在调用前显式降级，而不是运行时报错才发现平台不支持。
- `TokenProvider`：通用的 Token 缓存与刷新器，处理飞书 `tenant_access_token`、钉钉 `access_token`、
  QQ `access_token` 等“有效期内需缓存复用”的场景，内置并发刷新去重。
- `IdempotencyStore` / `InMemoryIdempotencyStore`：processing/succeeded/failed 三态 + 租约的幂等状态机，
  `BotManager` 默认启用，保证 at-least-once 投递下失败重推不丢消息（也不会重复副作用）。
- `withRetry` / `CircuitBreaker`（`src/core/outbound.ts`）：出站调用的指数退避重试与熔断，`WeComCustomBotAdapter`
  已接入作为参考实现。
- `BotManager`：按实例名注册多个已配置的适配器实例（同一平台可注册多个实例，见 `listByPlatform`），
  提供统一发送入口，并对入站消息做幂等分发（默认去重，可通过 `{ idempotency: false }` 关闭）。

## 已实现的基础功能

| 平台 | 适配器 | 发送 | 接收 | contextualReply |
|---|---|---|---|---|
| 飞书 | `FeishuCustomBotAdapter`（群 Webhook，支持加签） | ✅ 文本/富文本(md)/卡片 | ❌（Webhook 型单向推送） | ❌ |
| 飞书 | `FeishuAppBotAdapter`（自建应用） | ✅ 文本/交互卡片(markdown) | ❌ 未在本版本实现事件回调 | ❌ |
| 钉钉 | `DingTalkCustomBotAdapter`（群 Webhook，支持加签） | ✅ 文本/Markdown | ❌ | ❌ |
| 企业微信 | `WeComCustomBotAdapter`（群 Webhook，出站带重试） | ✅ 文本/Markdown | ❌ | ❌ |
| Telegram | `TelegramBotAdapter` | ✅ `sendMessage`，支持 `reply_to_message_id` | ✅ `getUpdates` 长轮询 | ✅ |
| QQ | `QQBotAdapter` | ✅ 群消息（access_token 鉴权） | ❌ 依赖官方 WebSocket 网关，未纳入本版本 | ❌ |

未实现接收能力的平台均为 Webhook 回调（飞书应用事件订阅、企微回调需要 AES 解密、QQ WebSocket 网关鉴权），
复杂度和风险明显高于发送，留作后续版本扩展（见 `ARCHITECTURE.md` 第 8 章）；`BaseBotAdapter` 已预留
`start()`/`stop()` 生命周期钩子供后续接入。

个人微信未纳入适配范围：官方未开放任何 Bot API，第三方协议方案存在较高封号风险（详见调研文档）。

## 使用示例

```ts
import { BotManager, FeishuCustomBotAdapter, TelegramBotAdapter } from "openimrobot";

const manager = new BotManager();

manager.register(
  "feishu-alert",
  new FeishuCustomBotAdapter({
    webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
    secret: process.env.FEISHU_BOT_SECRET,
  }),
);

manager.register(
  "telegram-support",
  new TelegramBotAdapter({ token: process.env.TELEGRAM_BOT_TOKEN! }),
);

manager.onMessage((name, message) => {
  console.log(`[${name}] ${message.chatId}: ${message.text}`);
});

await manager.sendText("feishu-alert", "_", "服务恢复正常");
await manager.startAll(); // 启动 Telegram 长轮询
```

## 开发

```bash
npm run typecheck   # 类型检查
npm test            # vitest 单元测试
npm run build       # 编译到 dist/
```

## 状态说明

本版本为基础框架 + 核心功能实现，已通过单元测试（HTTP 层以 mock fetch 验证签名与错误处理逻辑，
另含幂等去重、出站重试/熔断的专项单测，共 30 个测试用例），尚未针对真实平台账号做端到端联调，
接入生产环境前请自行验证。架构评审意见的落地情况与后续规划见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。
