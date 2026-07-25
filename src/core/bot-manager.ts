import type { BaseBotAdapter } from "./base-adapter.js";
import type { IncomingMessage } from "../types.js";

/**
 * 多平台机器人的统一注册表：按名称管理多个已配置的适配器实例，
 * 提供统一的发送入口与跨平台的入站消息事件分发。
 */
export class BotManager {
  private readonly adapters = new Map<string, BaseBotAdapter>();
  private readonly messageListeners: Array<
    (name: string, message: IncomingMessage) => void
  > = [];

  register(name: string, adapter: BaseBotAdapter): this {
    if (this.adapters.has(name)) {
      throw new Error(`适配器名称已存在: ${name}`);
    }
    this.adapters.set(name, adapter);
    adapter.onMessage((message) => {
      for (const listener of this.messageListeners) {
        listener(name, message);
      }
    });
    return this;
  }

  get(name: string): BaseBotAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(`未找到适配器: ${name}`);
    }
    return adapter;
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }

  onMessage(listener: (name: string, message: IncomingMessage) => void): this {
    this.messageListeners.push(listener);
    return this;
  }

  async startAll(): Promise<void> {
    await Promise.all([...this.adapters.values()].map((adapter) => adapter.start()));
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.adapters.values()].map((adapter) => adapter.stop()));
  }

  sendText(name: string, target: string, text: string): Promise<unknown> {
    return this.get(name).sendText(target, text);
  }
}
