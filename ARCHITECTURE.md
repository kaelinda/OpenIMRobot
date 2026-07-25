# 多平台 IM 机器人 SDK — 技术架构文档

版本：v0.2 ｜ 语言：TypeScript ｜ 状态：在 v0.1（`BaseBotAdapter` + `BotManager` 基础框架）之上，按架构评审意见修订

已实现平台：飞书（群 Webhook / 自建应用）、钉钉（群 Webhook）、企业微信（群 Webhook）、Telegram（长轮询收发）、QQ（群消息主动发送）
候选评估平台（未实现）：Discord、Slack ｜ 明确不实现：个人微信机器人（原因见 `docs/im-bot-api-research.md` 第 5 节风险提示）

> 本文档是 v0.1 draft 架构方案经评审后的修订版。评审给出的 10 项问题中，本版本落地了可以在**不推翻现有已测试实现**的前提下安全retrofit 的部分（#3/#4/#6/#7 的核心诉求，#1 的能力声明部分），其余需要配合"统一消息模型 + Adapter 契约"整体重构的部分（完整的 ReplyHandle/EventSink/EventQueue、Webhook 宿主解耦、Adapter 合约测试套件）显式列为 v0.3 计划，见第 8 章。这是一次务实的渐进式修订，而不是另起一套与已合并代码并行、互不兼容的实现。

---

## 1. 背景与目标

### 1.1 要解决的问题

飞书、钉钉、企业微信、Telegram、QQ 等平台各自有一套完全不同的机器人协议：认证方式不同、消息格式不同、长连接/长轮询/webhook 机制不同、加签方式不同。如果为每个平台单独写一套收发逻辑，业务代码要被迫写多份，且平台协议升级时改动面很大。

本项目服务于"多 Agent 协作平台接入 IM 机器人"场景，因此除了统一收发接口本身，还需要保证消息投递的生产可靠性（去重、失败重试不丢消息）和跨平台能力边界的可见性（业务/Agent 层能知道某个平台能不能做某件事，而不是运行时才发现失败）。

### 1.2 设计目标（不变）

1. **一次编写，多端运行**：业务逻辑面向统一的 `IncomingMessage` 模型和统一的 `BotManager`/`BaseBotAdapter` API。
2. **可插拔**：新增一个平台只需要新增一个 Adapter 类并注册进 `BotManager`。
3. **不重复造轮子**：优先使用 `fetch` + 平台 HTTP API 直连（各平台缺少官方 Node SDK 或官方 SDK 生态不统一时），减少不必要的第三方依赖。
4. **生产可用的横切能力**：内置去重（幂等）、Token 缓存刷新、出站重试/熔断等中间层能力。
5. **类型安全**：全程 TypeScript strict 模式。
6. **诚实的投递语义**：明确声明 `BotManager` 提供的是 **at-least-once + 幂等**，而不是 exactly-once。

### 1.3 非目标（当前版本不覆盖）

- 不做可视化的机器人管理后台。
- 不做消息存储/会话历史持久化。
- 不做多租户/多企业实例的**托管**方案。
- 不内置 Redis/消息队列实现（`IdempotencyStore` 是接口，生产环境可自行实现外部存储版本；仓库自带的 `InMemoryIdempotencyStore` 仅用于开发/测试/单实例场景）。
- 飞书/企微/钉钉的事件订阅回调（Webhook 接收 + 验签解密）本版本未实现，仅 Telegram 长轮询支持收发双向；QQ 仅支持主动发送。

---

## 2. 整体架构

```
src/
├── types.ts                 # Platform（可扩展字符串）、AdapterCapabilities、IncomingMessage
├── index.ts                 # 统一导出入口
├── core/
│   ├── base-adapter.ts      # BaseBotAdapter 抽象基类：platform + capabilities + sendText + start/stop + message 事件
│   ├── bot-manager.ts       # BotManager：多实例注册表 + 幂等分发（评审 #3 #4 #6）
│   ├── idempotency.ts       # IdempotencyStore：processing/succeeded/failed 三态 + 租约（评审 #3）
│   ├── outbound.ts          # withRetry + CircuitBreaker：出站重试/退避/熔断（评审 #7）
│   ├── token-provider.ts    # 通用 Token 缓存刷新器（飞书/QQ 等 access_token 场景）
│   ├── http.ts               # requestJson：统一 fetch + JSON 解析
│   └── errors.ts            # BotApiError
└── adapters/
    ├── feishu/{custom-bot,app-bot}.ts
    ├── dingtalk/custom-bot.ts
    ├── wecom/custom-bot.ts
    ├── telegram/bot.ts
    └── qq/bot.ts
```

**分层原则**：`BaseBotAdapter` 是所有平台的统一契约；`BotManager` 是编排层，管理多个已配置的 Adapter 实例、统一发送入口、统一入站消息分发（含幂等去重）；各 `adapters/*` 目录下的类只做协议转换和平台 HTTP 调用，不感知业务逻辑。业务层理论上只依赖 `BotManager` 和 `IncomingMessage`/`AdapterCapabilities` 类型，不需要 import 具体 Adapter 实现（除了实例化配置时）。

---

## 3. Adapter 契约与能力声明（评审 #1，部分落地）

### 3.1 现状

`BaseBotAdapter` 新增 `capabilities: AdapterCapabilities` 抽象只读字段，每个 Adapter 必须显式声明：

```typescript
export interface AdapterCapabilities {
  contextualReply: boolean;   // 能否在原消息上下文内回复
  proactiveSend: boolean;     // 能否主动推送
  interactiveCards: boolean;  // 富交互卡片
  markdown: boolean;          // Markdown / 富文本
  receivesMessages: boolean;  // 是否支持接收消息
}
```

各 Adapter 的能力声明如实反映当前实现（而不是平台协议理论上的上限）：

| Adapter | contextualReply | proactiveSend | interactiveCards | markdown | receivesMessages |
|---|---|---|---|---|---|
| `FeishuCustomBotAdapter` | ❌ | ✅ | ✅（`sendCard`） | ✅ | ❌（Webhook 单向推送） |
| `FeishuAppBotAdapter` | ❌ | ✅ | ✅（markdown 交互卡片） | ✅ | ❌（本版本未实现事件订阅） |
| `DingTalkCustomBotAdapter` | ❌ | ✅ | ❌ | ✅ | ❌ |
| `WeComCustomBotAdapter` | ❌ | ✅ | ❌ | ✅ | ❌ |
| `QQBotAdapter` | ❌ | ✅ | ❌ | ❌ | ❌（依赖官方 WebSocket 网关，未实现） |
| `TelegramBotAdapter` | ✅（`reply_to_message_id`） | ✅ | ❌ | ❌（未设置 `parse_mode`） | ✅（`getUpdates` 长轮询） |

`TelegramBotAdapter.sendText(chatId, text, replyToMessageId?)` 新增第三个可选参数，传入时会在原消息上下文中回复，体现 `contextualReply` 能力；不传则视为主动推送。业务/Agent 层在调用前应检查 `adapter.capabilities`，对不支持的能力做显式降级（例如目标平台不支持交互卡片时退化为纯文本），而不是依赖运行时抛错。

### 3.2 已知限制与 v0.3 计划

评审原文建议的完整方案是把"原消息上下文回复、临时 sessionWebhook、主动推送、流式回复"拆成 `InboundEnvelope.reply: ReplyHandle`（带 `expiresAt`）+ `adapter.send(target, message)` 两条独立路径，并要求 ack/投递解耦（`EventSink`）、可插拔 `EventQueue`、Webhook 宿主抽象（`HttpRequest`/`HttpResponse`）。这些改动会改变 `IncomingMessage` 的字段结构和 `BaseBotAdapter` 的方法签名，属于破坏性变更，需要配合"统一消息模型"整体升级、并让所有 Adapter 一起迁移，而不是逐个 Adapter 打补丁。v0.2 先落地能力声明本身（低风险、立即可用、已有测试覆盖），完整的 Envelope/ReplyHandle/EventQueue/Webhook 解耦方案列入 v0.3（见第 8 章），到时会一次性迁移全部 Adapter 并配套 Adapter 合约测试套件（评审 #10）。

---

## 4. 幂等与去重语义（评审 #3，已落地）

`src/core/idempotency.ts` 定义幂等状态机：

```
acquire(key, leaseMs) ──┬─→ 未处理过/租约已过期 → processing，返回 acquired=true
                        ├─→ succeeded（已处理成功）→ acquired=false, alreadySucceeded=true
                        └─→ processing 且租约未过期 → acquired=false（避免并发重复处理）

markSucceeded(key) → succeeded，此后同 key 永久短路
markFailed(key)    → 释放处理权，允许下一次重推重新 acquire（不丢消息）
```

`BotManager` 默认启用 `InMemoryIdempotencyStore`（可通过构造参数 `{ idempotency: false }` 关闭，或传入自定义 `IdempotencyStore` 实现接入 Redis 等外部存储）。分发逻辑（`BotManager.dispatch`）：

- 幂等 key 为 `${实例名}:${message.messageId}`。
- 只有**全部**注册的 `onMessage` 监听者都成功执行完毕，才调用 `markSucceeded`。
- 任一监听者抛出异常，调用 `markFailed`（释放处理权，允许重推后重试）并触发 `onDispatchError` 回调（默认 `console.error`），不会中断其他消息的处理。

**这是 at-least-once + 幂等语义，不是 exactly-once**：业务层的副作用操作（如调用外部 API 扣费）仍需自行保证幂等，或使用事务性 outbox。`InMemoryIdempotencyStore` 仅用于单实例开发/测试；生产环境必须替换为支持原子 CAS 写入、持久化、跨实例共享的实现（如 Redis `SET key val NX PX ttl`）。

测试覆盖：`tests/idempotency.test.ts`（状态机本身）+ `tests/bot-manager.test.ts`（重复投递只处理一次、失败后允许重试成功、`idempotency: false` 时行为回退）。

---

## 5. 平台可扩展性与多实例身份（评审 #4 #6，已落地）

- `Platform` 从 v0.1 的封闭 union（`"feishu" | "dingtalk" | "wecom" | "telegram" | "qq"`）改为带品牌标记的可扩展字符串类型（`type Platform = string & { readonly __platformBrand?: never }`），`BuiltinPlatform` 只提供内置平台的常量，不封死新增平台——新增一个平台（如 Discord/Slack）只需要新建 Adapter 类，`platform` 字段填任意字符串即可，不需要修改 `types.ts` 或重新发版。
- `BotManager` 本身就是按**实例名**（而非平台名）注册和路由的注册表：`register(name, adapter)` / `get(name)` / `sendText(name, ...)`。这天然支持"同一平台部署多个机器人实例"（评审 #6 的核心诉求：核心不应假设一平台一个实例），因为 key 从来就是自由字符串实例名，不是平台名。v0.2 新增 `listByPlatform(platform)` 帮助方法，用于枚举某个平台下已注册的所有实例，使这一能力更显式可见（测试见 `tests/bot-manager.test.ts`）。
- Adapter 的配置（token/secret/webhookUrl）始终通过构造函数参数注入，不依赖全局环境变量，允许同进程内运行同一平台的多个机器人实例（例如两个不同 Telegram Bot Token）。
- 多租户**托管**（SaaS 化按租户隔离部署）仍是非目标（1.3 节），当前场景下"实例名"已经是足够的隔离粒度。

---

## 6. 出站保护：重试与熔断（评审 #7，工具已落地，示例已接入）

`src/core/outbound.ts` 提供：

- `withRetry(fn, options)`：指数退避 + 抖动，`isRetryable` 可自定义哪些错误值得重试，`retryAfterMs` 可从错误中提取平台返回的 `Retry-After`。
- `CircuitBreaker`：连续失败达到 `failureThreshold` 后进入 `open` 状态短路一段时间（`openDurationMs`），到期后转 `half_open` 尝试放行一次探测。

`WeComCustomBotAdapter.send()` 已接入 `withRetry` 作为参考实现：只重试 `requestJson` 抛出的网络异常/JSON 解析失败等**瞬时**故障，不重试已解析响应后判断出的业务错误码（`errcode !== 0`），避免把确定性错误当瞬时故障重试（测试见 `tests/custom-bot-adapters.test.ts` 中 WeCom 相关用例，未因引入重试而改变断言/调用次数）。

**尚未接入的部分**：飞书/钉钉/QQ 的其余出站调用、Telegram 的 `sendMessage`/`getUpdates` 尚未包装 `withRetry`/`CircuitBreaker`（Telegram 的轮询循环本身有隐式重试效果，见 `runPollLoop` 的 `try/catch` + 继续下一轮）；入站限流、每会话背压控制（评审 #7 的另一半：`globalConcurrency`/`perConversationConcurrency`）本版本未实现，因为当前没有需要背压保护的高并发入站处理管道（仅 Telegram 单一长轮询）。这部分随 v0.3 的 `BotEngine`/`EventQueue` 一并引入，见第 8 章。

---

## 7. 安全（评审 #9，现状说明）

- **加签**：飞书自定义机器人（HMAC-SHA256 时间戳签名）、钉钉自定义机器人（HMAC-SHA256 URL 签名）已实现出站加签，与官方文档一致。
- **Token 缓存**：`TokenProvider` 统一处理飞书 `tenant_access_token`/QQ `access_token` 的缓存、并发刷新去重、`invalidate()` 手动失效。
- **尚未实现**（本版本诚实标注，非隐藏风险）：
  - 入站 Webhook 验签与防重放——本版本没有任何 Adapter 实现入站 Webhook 接收，因此暂不适用；一旦在 v0.3 实现飞书事件订阅/企微回调等入站 Webhook，必须在解析前基于原始请求字节校验签名并拒绝过期时间戳。
  - 日志脱敏——当前没有内置日志中间件（`BotManager` 的 `onDispatchError` 默认把消息对象整体传给回调/`console.error`），业务层如果直接打印 `message`/`raw` 需要自行脱敏；调用方应避免默认记录完整消息正文到持久化日志。
  - 附件/下载 URL 的 SSRF 防护——当前没有任何 Adapter 支持附件收发，暂不适用。

---

## 8. 后续规划（v0.3，明确列出未落地的评审项）

以下评审意见需要"统一消息模型 + Adapter 契约"整体重构才能落地，属于破坏性变更，本版本不做（避免半途而废的接口迁移）：

1. **完整的回复/主动推送分离**（评审 #1 剩余部分）：`InboundEnvelope` + `ReplyHandle`（带 `expiresAt`）+ `SendTarget`，取代裸的 `sendText(target, text)`。
2. **Ack 与投递解耦**（评审 #2）：引入 `EventSink`（`ack()`/`deliver()`/`reportError()`）与可插拔 `EventQueue`，为将来的飞书/钉钉事件订阅（3 秒 ack 超时）做准备；当前 Telegram 长轮询不需要 ack，暂无紧迫性。
3. **富消息模型**（评审 #5）：`content` 从纯文本升级为可辨识联合类型（text/mention/media/card_action/quote），并补充 `traceId`/`eventId`/会话线程等 Agent 编排所需字段。
4. **Webhook 宿主解耦**（评审 #8）：`handleHttpRequest(req: HttpRequest): Promise<HttpResponse>` 标准接口，供 Express/Fastify/Serverless 宿主统一调用，避免 Adapter 自建 HTTP server。
5. **背压与入站限流**（评审 #7 剩余部分）：`globalConcurrency`/`perConversationConcurrency` 队列 + 滑动窗口限流中间件。
6. **Adapter 合约测试套件**（评审 #10）：固定 fixture 驱动任意 Adapter 走完 `init/start/stop` 生命周期并校验投递事件字段完整性，作为"新增平台不改 core"承诺的自动化兜底，而非人工约定。
7. **正式实现**：飞书/企微事件订阅回调（Webhook 验签解密）、钉钉 Stream 模式、QQ WebSocket 网关接收。

v0.3 启动前提：先确定 1-3 项的字段设计不会与已有 5 个 Adapter 的现有调用方产生过多摩擦，一次性完成迁移，避免出现"一半 Adapter 用新契约、一半用旧契约"的中间态。
