import { describe, expect, it, vi } from "vitest";
import { BotManager } from "../src/core/bot-manager.js";
import { BaseBotAdapter } from "../src/core/base-adapter.js";
import type { IncomingMessage, Platform } from "../src/types.js";

class FakeAdapter extends BaseBotAdapter {
  readonly platform: Platform = "telegram";
  public sent: Array<{ target: string; text: string }> = [];

  async sendText(target: string, text: string): Promise<unknown> {
    this.sent.push({ target, text });
    return { ok: true };
  }

  simulateIncoming(message: IncomingMessage): void {
    this.emitMessage(message);
  }
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

  it("跨适配器的入站消息会带上注册名分发给监听者", () => {
    const manager = new BotManager();
    const adapter = new FakeAdapter();
    manager.register("bot1", adapter);
    const listener = vi.fn();
    manager.onMessage(listener);

    const message: IncomingMessage = {
      platform: "telegram",
      messageId: "1",
      chatId: "chat-1",
      text: "hi",
      timestamp: Date.now(),
      raw: {},
    };
    adapter.simulateIncoming(message);

    expect(listener).toHaveBeenCalledWith("bot1", message);
  });

  it("访问未注册的适配器抛出异常", () => {
    const manager = new BotManager();
    expect(() => manager.get("missing")).toThrow(/未找到适配器/);
  });
});
