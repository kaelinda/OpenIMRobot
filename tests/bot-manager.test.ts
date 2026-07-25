import { describe, expect, it, vi } from "vitest";
import { BotManager } from "../src/core/bot-manager.js";
import { BaseBotAdapter } from "../src/core/base-adapter.js";
import type { AdapterCapabilities, IncomingMessage, Platform } from "../src/types.js";

class FakeAdapter extends BaseBotAdapter {
  readonly platform: Platform = "telegram";
  readonly capabilities: AdapterCapabilities = {
    contextualReply: false,
    proactiveSend: true,
    interactiveCards: false,
    markdown: false,
    receivesMessages: true,
  };
  public sent: Array<{ target: string; text: string }> = [];

  async sendText(target: string, text: string): Promise<unknown> {
    this.sent.push({ target, text });
    return { ok: true };
  }

  simulateIncoming(message: IncomingMessage): void {
    this.emitMessage(message);
  }
}

function makeMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: "telegram",
    messageId: "1",
    chatId: "chat-1",
    text: "hi",
    timestamp: Date.now(),
    raw: {},
    ...overrides,
  };
}

/** dispatch() 现在是异步幂等分发，emitMessage 只是触发而不等待处理完成，需要放行一个事件循环 tick */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("BotManager", () => {
  it("注册重名适配器时抛出异常", () => {
    const manager = new BotManager();
    manager.register("a", new FakeAdapter());

    expect(() => manager.register("a", new FakeAdapter())).toThrow(/已存在/);
  });

  it("sendText 会代理到对应适配器", async () => {
    const manager = new BotManager();
    const adapter = new FakeAdapter();
    manager.register("bot1", adapter);

    await manager.sendText("bot1", "chat-1", "hello");

    expect(adapter.sent).toEqual([{ target: "chat-1", text: "hello" }]);
  });

  it("跨适配器的入站消息会带上注册名分发给监听者", async () => {
    const manager = new BotManager();
    const adapter = new FakeAdapter();
    manager.register("bot1", adapter);
    const listener = vi.fn();
    manager.onMessage(listener);

    const message = makeMessage();
    adapter.simulateIncoming(message);
    await flush();

    expect(listener).toHaveBeenCalledWith("bot1", message);
  });

  it("访问未注册的适配器抛出异常", () => {
    const manager = new BotManager();
    expect(() => manager.get("missing")).toThrow(/未找到适配器/);
  });

  it("listByPlatform 返回同一平台下的所有实例名（多账号场景）", () => {
    const manager = new BotManager();
    manager.register("bot-a", new FakeAdapter());
    manager.register("bot-b", new FakeAdapter());

    expect(manager.listByPlatform("telegram")).toEqual(["bot-a", "bot-b"]);
    expect(manager.listByPlatform("feishu")).toEqual([]);
  });

  it("默认内置去重：相同 messageId 的重复投递只会被处理一次", async () => {
    const manager = new BotManager();
    const adapter = new FakeAdapter();
    manager.register("bot1", adapter);
    const listener = vi.fn();
    manager.onMessage(listener);

    const message = makeMessage({ messageId: "dup-1" });
    adapter.simulateIncoming(message);
    adapter.simulateIncoming(message); // 模拟平台重推同一条消息
    await flush();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("监听者处理失败后不会把消息当成重复消息丢弃，允许重推后重试成功", async () => {
    const manager = new BotManager({ onDispatchError: () => {} });
    const adapter = new FakeAdapter();
    manager.register("bot1", adapter);

    let attempts = 0;
    manager.onMessage(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient failure");
    });

    const message = makeMessage({ messageId: "retry-1" });
    adapter.simulateIncoming(message);
    await flush();
    expect(attempts).toBe(1);

    adapter.simulateIncoming(message); // 平台重推
    await flush();
    expect(attempts).toBe(2);
  });

  it("传入 idempotency: false 时关闭去重，重复消息会被重复处理", async () => {
    const manager = new BotManager({ idempotency: false });
    const adapter = new FakeAdapter();
    manager.register("bot1", adapter);
    const listener = vi.fn();
    manager.onMessage(listener);

    const message = makeMessage({ messageId: "dup-2" });
    adapter.simulateIncoming(message);
    adapter.simulateIncoming(message);
    await flush();

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
