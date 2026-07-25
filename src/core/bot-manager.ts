import type { BaseBotAdapter } from "./base-adapter.js";
import { InMemoryIdempotencyStore, type IdempotencyStore } from "./idempotency.js";
import type { IncomingMessage } from "../types.js";

export type MessageListener = (
  name: string,
  message: IncomingMessage,
) => Promise<void> | void;

export interface BotManagerOptions {
  /**
   * 入站消息去重存储。默认启用 `InMemoryIdempotencyStore`（仅适合单实例开发/测试，
   * 生产环境应传入基于 Redis 等外部存储的实现）；传 `false` 显式关闭去重。
   *
   * 去重语义为 at-least-once：只有全部监听者成功处理完毕才标记 succeeded；
   * 任一监听者抛出异常则标记 failed，允许平台重推时重新处理，不会因为处理失败
   * 就把消息当成重复消息丢弃。
   */
  idempotency?: IdempotencyStore | false;
  /** 处理中租约时长（毫秒），处理进程崩溃时其他消费者可在租约到期后重新接管 */
  leaseMs?: number;
  /** 监听者抛出异常时的回调，默认 console.error，不会中断其他适配器/消息的处理 */
  onDispatchError?: (name: string, message: IncomingMessage, error: unknown) => void;
}

/**
 * 多平台机器人的统一注册表：按名称管理多个已配置的适配器实例，
 * 提供统一的发送入口与跨平台的入站消息事件分发。
 *
 * 一个平台可以注册多个实例（例如同一个 Telegram Bot Token 但不同用途），
 * `name` 即充当多账号/多实例场景下的实例标识。
 */
export class BotManager {
  private readonly adapters = new Map<string, BaseBotAdapter>();
  private readonly messageListeners: MessageListener[] = [];
  private readonly idempotency: IdempotencyStore | undefined;
  private readonly leaseMs: number;
  private readonly onDispatchError: BotManagerOptions["onDispatchError"];

  constructor(options: BotManagerOptions = {}) {
    this.idempotency =
      options.idempotency === false ? undefined : options.idempotency ?? new InMemoryIdempotencyStore();
    this.leaseMs = options.leaseMs ?? 30_000;
    this.onDispatchError =
      options.onDispatchError ??
      ((name, message, error) => {
        console.error(`[BotManager] 处理消息失败 (${name}/${message.messageId}):`, error);
      });
  }

  register(name: string, adapter: BaseBotAdapter): this {
    if (this.adapters.has(name)) {
      throw new Error(`适配器名称已存在: ${name}`);
    }
    this.adapters.set(name, adapter);
    adapter.onMessage((message) => {
      void this.dispatch(name, message);
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

  /** 列出某个平台下已注册的所有实例名，用于多账号/多实例场景（评审意见：核心不应假设一平台一个实例） */
  listByPlatform(platform: string): string[] {
    return [...this.adapters.entries()]
      .filter(([, adapter]) => adapter.platform === platform)
      .map(([name]) => name);
  }

  onMessage(listener: MessageListener): this {
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

  /**
   * 幂等分发：只有全部监听者成功处理完毕才标记 succeeded；任一监听者抛出异常则标记 failed，
   * 允许平台重推时重新处理（at-least-once + 幂等，而非 exactly-once，见 ARCHITECTURE.md 第 5 章）。
   */
  private async dispatch(name: string, message: IncomingMessage): Promise<void> {
    const key = `${name}:${message.messageId}`;

    if (this.idempotency) {
      const result = await this.idempotency.acquire(key, this.leaseMs);
      if (!result.acquired) {
        return; // 已成功处理过，或其他消费者正在处理中，短路跳过
      }
    }

    try {
      for (const listener of this.messageListeners) {
        await listener(name, message);
      }
      await this.idempotency?.markSucceeded(key);
    } catch (error) {
      await this.idempotency?.markFailed(key);
      this.onDispatchError?.(name, message, error);
    }
  }
}
