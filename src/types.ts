export type Platform = "feishu" | "dingtalk" | "wecom" | "telegram" | "qq";

/**
 * 各平台归一化后的入站消息，供上层业务统一消费。
 */
export interface IncomingMessage {
  platform: Platform;
  /** 平台原始消息 ID */
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
