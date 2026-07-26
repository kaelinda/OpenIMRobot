import { EventEmitter } from "node:events";
import type { AdapterCapabilities, IncomingMessage, Platform, StreamingHandle } from "../types.js";

/**
 * 所有平台适配器的基类：统一发送接口 + 统一的入站消息事件。
 * - Webhook 单向推送型适配器（飞书/钉钉/企微自定义机器人）不需要重写 start()/stop()。
 * - 长连接 / 长轮询型适配器（Telegram 等）重写 start()/stop() 管理生命周期。
 */
export abstract class BaseBotAdapter extends EventEmitter {
  abstract readonly platform: Platform;
  /** 能力声明，业务/Agent 层应据此显式降级而非依赖运行时报错 */
  abstract readonly capabilities: AdapterCapabilities;

  /** 发送纯文本消息，target 含义随平台而定（chat_id / webhook 固定群等） */
  abstract sendText(target: string, text: string): Promise<unknown>;

  /** 发送 Markdown / 富文本消息，非所有平台都在基础版本中实现 */
  sendMarkdown?(target: string, markdown: string): Promise<unknown>;

  /**
   * 以流式方式发送消息：创建一条消息后返回 `StreamingHandle`，通过 `update` 增量更新内容。
   * 仅当 `capabilities.streamingOutput` 为 true 且构造时开启了 `features.streamingOutput`
   * 的 Adapter 才实现此方法（见 `core/features.ts` 的 `resolveFeatureToggles`）。
   */
  sendStreamingText?(target: string, initialText: string): Promise<StreamingHandle>;

  async start(): Promise<void> {
    // 默认无需启动：纯 Webhook 推送型适配器没有常驻连接
  }

  async stop(): Promise<void> {
    // 默认无需停止
  }

  onMessage(listener: (message: IncomingMessage) => void): this {
    this.on("message", listener as (...args: unknown[]) => void);
    return this;
  }

  protected emitMessage(message: IncomingMessage): void {
    this.emit("message", message);
  }
}
