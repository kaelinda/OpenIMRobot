import { describe, expect, it } from "vitest";
import {
  resolveConnectivityChecksFromEnv,
  runConnectivityChecks,
} from "../src/connectivity.js";
import { BotManager } from "../src/core/bot-manager.js";
import { BaseBotAdapter } from "../src/core/base-adapter.js";
import type { AdapterCapabilities, Platform } from "../src/types.js";

class FakeAdapter extends BaseBotAdapter {
  readonly platform: Platform = "fake";
  readonly capabilities: AdapterCapabilities = {
    contextualReply: false,
    proactiveSend: true,
    interactiveCards: false,
    markdown: false,
    receivesMessages: false,
  };
  public sent: Array<{ target: string; text: string }> = [];

  constructor(private readonly shouldFail = false) {
    super();
  }

  async sendText(target: string, text: string): Promise<unknown> {
    if (this.shouldFail) {
      throw new Error("send failed");
    }
    this.sent.push({ target, text });
    return { ok: true };
  }
}

describe("resolveConnectivityChecksFromEnv", () => {
  it("未配置任何环境变量时返回空数组", () => {
    expect(resolveConnectivityChecksFromEnv({})).toEqual([]);
  });

  it("只配置飞书 Webhook 时只返回飞书一项", () => {
    const checks = resolveConnectivityChecksFromEnv({
      FEISHU_WEBHOOK_URL: "https://example.com/feishu",
    });

    expect(checks).toHaveLength(1);
    expect(checks[0].name).toBe("feishu");
    expect(checks[0].target).toBe("_");
  });

  it("同时配置多个平台时按顺序全部返回", () => {
    const checks = resolveConnectivityChecksFromEnv({
      FEISHU_WEBHOOK_URL: "https://example.com/feishu",
      DINGTALK_WEBHOOK_URL: "https://example.com/dingtalk",
      WECOM_WEBHOOK_URL: "https://example.com/wecom",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat-1",
    });

    expect(checks.map((c) => c.name)).toEqual([
      "feishu",
      "dingtalk",
      "wecom",
      "telegram",
    ]);
  });

  it("Telegram 只配置 Token 未配置 ChatId 时不会被纳入检查", () => {
    const checks = resolveConnectivityChecksFromEnv({
      TELEGRAM_BOT_TOKEN: "token",
    });

    expect(checks).toEqual([]);
  });

  it("Telegram 同时配置 Token 与 ChatId 时使用 ChatId 作为 target", () => {
    const checks = resolveConnectivityChecksFromEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat-42",
    });

    expect(checks).toHaveLength(1);
    expect(checks[0].name).toBe("telegram");
    expect(checks[0].target).toBe("chat-42");
  });
});

describe("runConnectivityChecks", () => {
  it("全部平台发送成功时返回 ok: true", async () => {
    const manager = new BotManager();
    const adapter = new FakeAdapter();
    manager.register("feishu", adapter);

    const results = await runConnectivityChecks(
      manager,
      [{ name: "feishu", target: "_", adapter }],
      "hello",
    );

    expect(results).toEqual([{ name: "feishu", ok: true }]);
    expect(adapter.sent).toEqual([{ target: "_", text: "hello" }]);
  });

  it("单个平台发送失败时记录错误信息，不影响其他平台继续执行", async () => {
    const manager = new BotManager();
    const failingAdapter = new FakeAdapter(true);
    const okAdapter = new FakeAdapter();
    manager.register("feishu", failingAdapter);
    manager.register("dingtalk", okAdapter);

    const results = await runConnectivityChecks(
      manager,
      [
        { name: "feishu", target: "_", adapter: failingAdapter },
        { name: "dingtalk", target: "_", adapter: okAdapter },
      ],
      "hello",
    );

    expect(results).toEqual([
      { name: "feishu", ok: false, error: "send failed" },
      { name: "dingtalk", ok: true },
    ]);
  });
});
