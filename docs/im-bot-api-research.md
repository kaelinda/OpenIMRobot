# 各平台机器人（Bot）API 调研文档

> 调研目的：为 OpenIMRobot 统一封装各平台机器人接入层提供依据。以下信息来自官方文档与公开资料检索，标注了置信度（高/中/低），建议实现前再对照最新官方文档二次核实（各平台接口迭代较快）。

---

## 1. 飞书机器人（Feishu / Lark）

**官方文档**
- 开放平台首页：https://open.feishu.cn/
- 自定义机器人（webhook）：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot?lang=zh-CN
- 机器人常见问题：https://open.feishu.cn/document/faq/bot?lang=zh-CN
- 事件订阅 / 长连接：https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case?lang=zh-CN

**开放程度**：官方全面开放（置信度：高）

**接入方式**
- **自定义机器人（群 webhook）**：在群设置中添加机器人即可获取 Webhook URL，无需应用审核；可选配置关键词、IP 白名单、签名校验（secret 加签）。**仅支持单向推送**，机器人不能主动接收/回复群消息。
- **自建应用机器人**：控制台创建企业自建应用 → 获取 `App ID` / `App Secret` → 调用 `/auth/v3/tenant_access_token` 获取访问令牌 → 通过服务端 API 发送消息、管理会话。
  - 消息收发：支持 **Webhook 回调**（需公网服务器 + 域名/证书）或 **长连接（WebSocket，事件订阅）**——长连接模式无需公网 IP，但仅企业自建应用可用，单应用最多 50 个连接，收到事件需 3 秒内处理完毕。
  - 应用需经过“版本管理与发布”流程后才能使用长连接等能力。
- **消息类型**：文本、富文本 post、图片、卡片（互动卡片 Card JSON）、群名片、文件、语音等。

**限制**
- 自建应用需企业管理员在管理后台安装启用；对外分发的应用需走应用市场审核。
- 长连接单应用最多 50 连接，事件处理超时会被视为失败。
- 群机器人 webhook 有调用频率限制（官方未公开具体量级，社区反馈约为每分钟数十次级别，需自行限流重试）。
- **官方 SDK**：Golang、Python、Java、Node.js（事件订阅/长连接均有示例 SDK）。

---

## 2. 钉钉机器人（DingTalk）

**官方文档**
- 开放平台首页：https://open.dingtalk.com/
- 机器人概述：https://open.dingtalk.com/document/group/robot-overview
- 自定义机器人接入：https://open.dingtalk.com/document/robots/custom-robot-access
- 获取自定义机器人 Webhook：https://open.dingtalk.com/document/dingstart/obtain-the-webhook-address-of-a-custom-robot
- 企业内部机器人 Webhook 发消息：https://open.dingtalk.com/document/development/assign-a-webhook-url-to-an-internal-chatbot
- Stream 模式概述：https://open-dingtalk.github.io/developerpedia/docs/learn/stream/overview/
- Python Stream SDK：https://github.com/open-dingtalk/dingtalk-stream-sdk-python

**开放程度**：官方全面开放（置信度：高）

**接入方式**
- **自定义机器人（群 webhook）**：群设置中添加自定义机器人获取 Webhook 地址，支持加签（HMAC-SHA256）、关键词、IP 段三种安全设置任选其一；仅支持向该群**单向推送**，不支持单聊、不支持接收消息。
- **企业内部应用机器人**：控制台创建企业内部应用 → 获取 `AppKey`/`AppSecret`（或 Client ID/Secret）→ 换取 `access_token` → 调用机器人发消息接口向指定用户/群发送消息；也可配置为群内机器人进行双向交互。
  - 消息收发两种模式：
    - **Webhook 模式**：需要公网服务器、域名、HTTPS 证书，钉钉服务端主动回调。
    - **Stream 模式（推荐）**：基于 WebSocket 的长连接，**无需公网 IP/域名/证书**，集成官方 SDK 即可收发消息、接收事件与卡片回调，显著降低接入门槛。
  - 官方 SDK：Python、Java、Go、Node.js 等（`dingtalk-stream-sdk-*` 系列）。
- **消息类型**：文本、Markdown、ActionCard、FeedCard、link、交互卡片等。

**限制**
- 自定义机器人 webhook 官方限流约为 **20 条/分钟**（超出会被限流，需自行退避重试，具体以官方最新文档为准）。
- 企业内部应用机器人需企业管理员在钉钉管理后台安装；面向外部分发需走应用市场审核。
- Stream 模式对连接数、消息体大小有限制，需参考官方最新文档。

---

## 3. Telegram 机器人（Telegram Bot API）

**官方文档**
- Bot API 总文档：https://core.telegram.org/bots/api
- Bot API Changelog：https://core.telegram.org/bots/api-changelog
- 通过 [@BotFather](https://t.me/BotFather) 创建机器人

**开放程度**：官方全面开放，全球范围内是接入门槛最低、文档最完善的平台之一（置信度：高）

**接入方式**
- 通过 BotFather 创建 Bot，获取唯一 `Bot Token`（形如 `123456:ABC-DEF...`），所有 API 调用均基于 HTTPS + Token 鉴权，无需 App 审核。
- **消息收发两种互斥模式**：
  - `getUpdates` 长轮询：适合无公网 IP 的场景，简单直接。
  - `setWebhook` 推送：需要公网 HTTPS 地址（支持端口 443/80/88/8443），Telegram 服务器主动推送更新；设置 Webhook 后长轮询失效，二者互斥。
- **消息类型**：文本（支持 Markdown/HTML 富文本）、图片、文件、语音、视频、贴纸、位置、Inline Keyboard/Reply Keyboard 交互按钮、Poll 投票、Web App 等，类型最丰富。
- **官方 SDK / 社区 SDK**：无官方语言 SDK，但社区维护质量很高，覆盖几乎所有主流语言：Python（`python-telegram-bot`、`aiogram`、`pyTelegramBotAPI`）、Node.js（`telegraf`、`node-telegram-bot-api`）、Go（`telebot`）、Java（`TelegramBots`）等。

**限制**
- 全局限流约 **30 条消息/秒**（面向不同用户的批量推送）；同一群组 **约 20 条/分钟**；同一会话建议 **不超过 1 条/秒**，超限返回 `429 Too Many Requests` 并可能触发临时封禁。Bot API 7.1 起可通过支付 Telegram Stars 提升至 1000 条/秒。
- Update 在服务器保留不超过 24 小时（未拉取会丢弃）。
- 国内网络访问 Telegram API 通常需要代理/专线，这是实际部署中的主要限制而非 API 本身限制。
- 无企业资质要求，个人即可注册和使用。

---

## 4. 企业微信机器人（WeCom）

**官方文档**
- 开发者中心首页：https://developer.work.weixin.qq.com/
- 开发前必读：https://developer.work.weixin.qq.com/document/path/90664
- 获取 access_token：https://developer.work.weixin.qq.com/document/path/91039
- 应用推送消息：https://developer.work.weixin.qq.com/document/path/90248
- 消息推送配置说明：https://developer.work.weixin.qq.com/document/path/91770
- 智能机器人长连接：https://developer.work.weixin.qq.com/document/path/101463

**开放程度**：官方全面开放，企业内部场景成熟（置信度：高）

**接入方式**
- **群机器人（webhook）**：群聊右键菜单添加机器人，获得形如 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx` 的地址，直接 POST 消息即可，无需审核；支持文本、markdown（markdown_v2）、图片、图文（news）、文件、语音、模板卡片等 8 种消息类型；也支持通过“智能机器人长连接”能力实现**双向**收发（接收群成员 @机器人 的消息并回复）。
- **自建应用机器人**：企业管理后台创建自建应用 → 获取 `CorpID`（企业唯一）、`AgentID`、`Secret` → 调用 `gettoken` 接口获取 `access_token`（默认有效期 7200 秒，需自行缓存，频繁调用会被限流）→ 调用消息发送接口向成员/部门/群发送消息；支持接收回调消息（需配置回调 URL + Token/EncodingAESKey，消息体加密）。
- **消息类型**：文本、图片、语音、视频、文件、图文、markdown、小程序通知、模板卡片等，功能最全面（媲美企业内部 OA 场景）。

**限制**
- 群机器人回调（双向对话）限流约 **30 条/分钟、1000 条/小时**（针对单一会话）。
- `access_token` 有调用频率限制，必须缓存复用，禁止频繁刷新。
- 自建应用仅限企业内部使用，需要企业微信认证的组织（个人无法申请企业微信）。
- **官方 SDK**：官方未提供多语言 SDK，主要依赖 HTTP API + 社区封装（Python 有 `wechatpy`、`itchatmate` 等第三方库；Node.js/Java/Go 均有社区 SDK）。

---

## 5. 微信（个人微信 与 微信公众号/服务号）

**官方文档**
- 公众平台开发文档：https://developers.weixin.qq.com/doc/service/guide/
- 服务号认证/资质说明：https://developers.weixin.qq.com/community/develop/doc/00020836a94718ca225006fab6b800

**开放程度**：
- **个人微信**：**官方未开放任何 Bot/自动化 API**（否/置信度：高）。
- **微信公众号（服务号）**：**部分开放**，仅限企业/组织资质主体，个人主体不可申请微信认证、不可注册服务号（置信度：高）。

**接入方式（官方合规路径 —— 公众号/服务号）**
- 认证主体必须为企业、个体工商户、政府、媒体等机构（需营业执照等资质材料），个人主体公众号（订阅号）无法通过微信认证，也无法获得客服消息等接口权限。
- 认证后可通过 `AppID` + `AppSecret` 获取 `access_token`，调用客服消息接口（被动回复 + 48 小时内主动客服消息）、模板消息/订阅消息接口进行消息收发。
- 消息收发以**服务端 URL 回调**为主（用户发消息 → 微信服务器 POST 到开发者配置的 URL），无长连接/WebSocket 方式。
- 消息类型：文本、图片、语音、视频、图文、模板消息、卡券等。

**个人微信的社区/第三方方案（非官方，存在较高风险）**
- **Web 协议类**（如早期 `itchat`）：基于网页版微信协议，**微信官方已于多年前关闭网页版登录入口，此类方案基本失效**，不建议采用。
- **Wechaty**（https://wechaty.js.org/）：整合多种协议 Puppet（网页协议、iPad 协议、企业微信协议等），是目前社区最活跃、协议支持最广的个人微信自动化框架，但底层协议均非官方开放，存在被判定为异常登录/自动化行为而被限制登录甚至封号的风险。
- **协议模拟方案**（如基于 iPad/Mac 协议、逆向的第三方“云控”“hook”方案）：稳定性和封号风险因协议而异；高频操作、异地登录、批量群发极易触发风控。
- **企业微信互通方案**：让客户添加“企业微信”客服号，利用企业微信官方开放的 API 与外部联系人（个人微信好友）合规收发消息，是当前风险最低、相对推荐的“类微信机器人”替代方案，但本质是企业微信而非个人微信。

**风险提示（务必在文档中注明）**：任何非官方个人微信自动化手段均可能违反微信用户协议，存在账号被限制登录、永久封禁的风险，且协议随时可能因微信客户端升级而失效，不适合作为生产环境稳定依赖；OpenIMRobot 若接入个人微信，建议仅作为可选适配器并在文档中明确风险免责声明。

---

## 6. QQ 机器人（QQ 开放平台）

**官方文档**
- 官方文档首页：https://bot.q.qq.com/wiki
- 接入指南：https://bot.q.qq.com/wiki/develop/api-v2/
- 群管理：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/group/manage/
- 消息收发：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html

**开放程度**：部分开放，且开发者主体类型决定可用场景范围（置信度：中高）

**接入方式**
- QQ 开放平台创建机器人应用，获得 `BotAppID`、`BotSecret`（Token 格式为 `AppID:AppSecret`）。
- 通信方式：**WebSocket 长连接**（`createWebsocket`，获取网关地址后建立连接接收事件）为主，同时支持 **Webhook 回调**方式接收事件推送（官方文档提供两种接入路径）。
- 支持场景：**QQ 频道**（原生支持最完善）与**普通 QQ 群**（企业主体默认支持；个人主体默认仅支持频道场景，群场景需额外权限）。群场景“机器人主动发消息”能力已于官方公告的时间点起逐步全量开放，需群主手动开启“允许机器人主动发言”。
- 消息类型：文本、Markdown、图片、embed 卡片、ark 模板消息、语音、按钮交互组件等。
- 上线前需先在**沙箱环境**（沙箱群/频道成员数需 ≤20 人）完成功能自测，通过审核后才能全量发布。

**限制**
- **企业资质认证**：申请群场景机器人能力、机器人上架/公开使用通常需要企业主体认证（含资质审核 + 打款验证流程）；个人主体权限受限，通常仅能在频道场景或私域测试环境使用。
- 需通过官方审核（内容审核、功能审核）方可正式上线对外提供服务。
- 官方未提供统一多语言 SDK，社区有 Node.js（`qq-guild-bot`）、Python（`botpy`，官方仓库 `QQGuildDev/botpy`）等 SDK/框架封装；国内成熟 IM 框架 LangBot、Mirai 生态等也提供了 QQ 官方机器人接入适配层可参考。
- 不同于频道机器人早期形态，普通 QQ 群支持能力是近年逐步放开的，接入前建议再次核实官方最新权限矩阵。

---

## 综合对比表

| 平台 | 官方开放程度 | 认证方式 | 通信方式 | 是否需企业资质 | 官方/主流 SDK | 主要风险 |
|---|---|---|---|---|---|---|
| 飞书 | 全面开放 | AppID/AppSecret（自建应用）或 Webhook Key（自定义机器人） | Webhook 回调 / WebSocket 长连接 | 企业自建应用需企业账号，webhook 无需 | Go/Python/Java/Node.js（官方） | 长连接连接数/超时限制 |
| 钉钉 | 全面开放 | AppKey/AppSecret 或 Webhook 地址+加签 | Webhook / Stream(WebSocket，推荐) | 企业内部应用需企业账号，webhook 无需 | Python/Java/Go/Node.js（官方 Stream SDK） | 群 webhook 限流约20条/分钟 |
| Telegram | 全面开放 | Bot Token（BotFather 签发） | 长轮询 getUpdates / Webhook | 否，个人可用 | 无官方 SDK，社区库丰富 | 国内网络访问需代理；限流 30条/秒 |
| 企业微信 | 全面开放 | CorpID/Secret（自建应用）或 Webhook Key（群机器人） | Webhook 回调 / 群机器人长连接 | 是（企业微信认证组织） | 无官方 SDK，社区封装 | access_token 需缓存限流 |
| 微信（个人号） | **不开放** | 无官方认证 | 依赖第三方协议 | 否（但方案本身不合规） | Wechaty 等第三方框架 | **封号风险高，协议随时失效** |
| 微信公众号/服务号 | 部分开放（仅企业主体） | AppID/AppSecret | Webhook 回调为主 | 是（企业/组织资质） | 无官方 SDK，社区封装（如 wechatpy） | 个人主体无法使用 |
| QQ 机器人 | 部分开放 | BotAppID/BotSecret | WebSocket 长连接 / Webhook | 群场景通常需企业资质 | 官方 botpy（Python），社区多语言封装 | 个人主体权限受限，需审核 |

---

## 建议（供 OpenIMRobot 架构参考）

1. **统一抽象层**建议按“Webhook 单向推送”“长连接/WebSocket 双向交互”“服务端轮询”三种通信模式做适配器分层，而不是按平台硬编码，因为飞书/钉钉/企业微信/QQ 都同时提供 Webhook 与长连接两条路径。
2. Token/AccessToken 的**获取与缓存刷新逻辑**（企业微信、飞书、钉钉均为 2 小时左右有效期）建议抽象为统一的 `TokenProvider` 接口，避免各平台重复实现限流保护。
3. 个人微信不建议作为一等公民支持，若要支持应明确标注“非官方/风险自担”，并推荐优先引导用户使用企业微信作为替代。
4. QQ 与部分场景（企业微信自建应用外部分发、公众号认证）涉及企业资质审核，建议在项目 README 中提前告知用户需自行完成平台侧的资质认证，OpenIMRobot 只负责协议对接。

---

## 信息来源

- [自定义机器人使用指南 - 飞书开放平台](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot?lang=zh-CN)
- [机器人相关 FAQ - 飞书开放平台](https://open.feishu.cn/document/faq/bot?lang=zh-CN)
- [使用长连接接收事件 - 飞书开放平台](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case?lang=zh-CN)
- [钉钉开放平台 - 机器人概述](https://open.dingtalk.com/document/group/robot-overview)
- [自定义机器人接入 - 钉钉开放平台](https://open.dingtalk.com/document/robots/custom-robot-access)
- [获取自定义机器人 Webhook 地址 - 钉钉开放平台](https://open.dingtalk.com/document/dingstart/obtain-the-webhook-address-of-a-custom-robot)
- [企业内部机器人使用Webhook发送群聊消息 - 钉钉开放平台](https://open.dingtalk.com/document/development/assign-a-webhook-url-to-an-internal-chatbot)
- [钉钉 Stream 模式概述 - 开发者百科](https://open-dingtalk.github.io/developerpedia/docs/learn/stream/overview/)
- [dingtalk-stream-sdk-python - GitHub](https://github.com/open-dingtalk/dingtalk-stream-sdk-python)
- [Telegram Bot API 官方文档](https://core.telegram.org/bots/api)
- [Telegram Bot API Changelog](https://core.telegram.org/bots/api-changelog)
- [Telegram Bot API Rate Limits 说明](https://gramio.dev/rate-limits)
- [企业微信开发者中心 - 开发前必读](https://developer.work.weixin.qq.com/document/path/90664)
- [企业微信 - 获取access_token](https://developer.work.weixin.qq.com/document/path/91039)
- [企业微信 - 应用推送消息](https://developer.work.weixin.qq.com/document/path/90248)
- [企业微信 - 消息推送配置说明](https://developer.work.weixin.qq.com/document/path/91770)
- [企业微信 - 智能机器人长连接](https://developer.work.weixin.qq.com/document/path/101463)
- [微信开放社区 - 服务号开发指南](https://developers.weixin.qq.com/doc/service/guide/)
- [微信开放社区 - 个人主体是否可认证](https://developers.weixin.qq.com/community/develop/doc/00020836a94718ca225006fab6b800)
- [Wechaty 官网](https://wechaty.js.org/)
- [企微、个微机器人调研 - GbyAI](https://gby.ai/wechat-bot/)
- [QQ 机器人官方文档 - 接入指南](https://bot.q.qq.com/wiki/develop/api-v2/)
- [QQ 机器人官方文档 Wiki 首页](https://bot.q.qq.com/wiki)
- [QQ 机器人 - 群管理](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/group/manage/)
- [QQ 机器人 - 消息收发](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html)

---

*注：本次调研仅通过网络检索与官方文档整理生成，部分限流数值（如飞书群机器人调用频率、QQ群场景开放时间节点）官方文档未给出精确公开数字或存在版本迭代，实现前建议以各平台开发者后台当前展示的最新规则为准。*
