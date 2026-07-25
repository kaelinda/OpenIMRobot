/**
 * 平台标识：可扩展的字符串品牌类型，而非封闭 union。
 * 内置平台通过 `BuiltinPlatform` 提供常量与类型提示；新增平台（含第三方 Adapter）
 * 只需要使用一个新的字符串值，不需要修改这里的类型定义或重新发布本包。
 */
export type Platform = string & { readonly __platformBrand?: never };

export const BuiltinPlatform = {
  Feishu: "feishu",
  DingTalk: "dingtalk",
  WeCom: "wecom",
  Telegram: "telegram",
  QQ: "qq",
} as const;

/**
 * 各平台归一化后的入站消息，供上层业务统一消费。
 */
export interface IncomingMessage {
  platform: Platform;
  /** 平台原始消息 ID，同时作为幂等去重的 key（见 BotManager 的内置去重） */
  messageId: string;
  /** 群聊 / 频道 / 会话 ID */
  chatId: string;
  /** 发送者 ID（部分平台可能拿不到） */
  senderId?: string;
  text: string;
  /** 毫秒时间戳 */
  timestamp: number;
  /** 平台原始事件负载，便于业务方按需访问平台专属字段 */
  raw: unknown;
}

/**
 * Adapter 在协议层面能提供的能力声明。业务/Agent 层应在发送前检查能力做显式降级，
 * 而不是依赖运行时报错（例如：平台不支持交互卡片时退化为纯文本）。
 *
 * 当前版本（v0.2）先落地能力声明本身；`contextualReply`（原消息上下文回复句柄）、
 * 出站消息的能力对齐（streaming/threads 等）留待 v0.3 随「统一消息模型」升级一并实现，
 * 详见 ARCHITECTURE.md 第 13 节。
 */
export interface AdapterCapabilities {
  /** 能否在原消息上下文内回复（例如 Telegram 的 reply_to_message_id） */
  contextualReply: boolean;
  /** 能否脱离入站事件主动向任意会话推送消息 */
  proactiveSend: boolean;
  /** 富交互卡片（飞书 interactive card 等） */
  interactiveCards: boolean;
  /** Markdown / 富文本 */
  markdown: boolean;
  /** 是否需要接收消息（Webhook 单向推送型适配器为 false） */
  receivesMessages: boolean;
}
