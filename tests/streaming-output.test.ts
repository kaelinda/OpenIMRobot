import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveFeatureToggles } from "../src/core/features.js";
import { FeishuAppBotAdapter } from "../src/adapters/feishu/app-bot.js";
import { FeishuCustomBotAdapter } from "../src/adapters/feishu/custom-bot.js";
import { TelegramBotAdapter } from "../src/adapters/telegram/bot.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveFeatureToggles", () => {
  it("未显式传入时默认关闭", () => {
    expect(resolveFeatureToggles("x", { streamingOutput: true }, undefined)).toEqual({
      streamingOutput: false,
    });
  });

  it("capabilities 支持时可以显式开启", () => {
    expect(
      resolveFeatureToggles("x", { streamingOutput: true }, { streamingOutput: true }),
    ).toEqual({ streamingOutput: true });
  });

  it("capabilities 不支持时开启会立即抛错", () => {
    expect(() =>
      resolveFeatureToggles("x", { streamingOutput: false }, { streamingOutput: true }),
    ).toThrow(/streamingOutput/);
  });
});

describe("能力声明", () => {
  it("Webhook 单向推送型 Adapter 的 streamingOutput 能力为 false", () => {
    const bot = new FeishuCustomBotAdapter({ webhookUrl: "https://open.feishu.cn/webhook/xxx" });
    expect(bot.capabilities.streamingOutput).toBe(false);
    expect(bot.sendStreamingText).toBeUndefined();
  });
});

describe("FeishuAppBotAdapter 流式输出", () => {
  it("未开启 features.streamingOutput 时调用 sendStreamingText 会抛错", async () => {
    const bot = new FeishuAppBotAdapter({ appId: "id", appSecret: "secret" });
    await expect(bot.sendStreamingText("chat-1", "hello")).rejects.toThrow(/streamingOutput/);
  });

  it("开启后 sendStreamingText 创建卡片，update/finish 通过 PATCH 增量更新同一条消息", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("tenant_access_token")) {
        return jsonResponse({ code: 0, msg: "ok", tenant_access_token: "token", expire: 7200 });
      }
      if (init?.method === "POST" && url.includes("/im/v1/messages?")) {
        return jsonResponse({ code: 0, msg: "ok", data: { message_id: "om_123" } });
      }
      if (init?.method === "PATCH" && url.includes("/im/v1/messages/om_123")) {
        return jsonResponse({ code: 0, msg: "ok" });
      }
      throw new Error(`unexpected call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const bot = new FeishuAppBotAdapter({
      appId: "id",
      appSecret: "secret",
      features: { streamingOutput: true },
    });

    const handle = await bot.sendStreamingText("chat-1", "第一段");
    await handle.update("第一段第二段");
    await handle.finish("第一段第二段（完）");

    const patchCalls = fetchMock.mock.calls.filter(
      ([url, init]) => init?.method === "PATCH" && url.includes("/im/v1/messages/om_123"),
    );
    expect(patchCalls).toHaveLength(2);
    const lastBody = JSON.parse(patchCalls[1][1].body as string);
    const content = JSON.parse(lastBody.content);
    expect(content.elements).toEqual([{ tag: "markdown", content: "第一段第二段（完）" }]);
  });
});

describe("TelegramBotAdapter 流式输出", () => {
  it("未开启 features.streamingOutput 时调用 sendStreamingText 会抛错", async () => {
    const bot = new TelegramBotAdapter({ token: "t" });
    await expect(bot.sendStreamingText("chat-1", "hello")).rejects.toThrow(/streamingOutput/);
  });

  it("开启后 sendStreamingText 创建消息，update/finish 通过 editMessageText 更新同一条消息", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (url.endsWith("/sendMessage")) {
        return jsonResponse({ ok: true, result: { message_id: 100 } });
      }
      if (url.endsWith("/editMessageText")) {
        expect(body.message_id).toBe(100);
        return jsonResponse({ ok: true, result: { message_id: 100 } });
      }
      throw new Error(`unexpected call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const bot = new TelegramBotAdapter({ token: "t", features: { streamingOutput: true } });

    const handle = await bot.sendStreamingText("chat-1", "first");
    await handle.update("first second");
    await handle.finish("first second (done)");

    const editCalls = fetchMock.mock.calls.filter(([url]) => (url as string).endsWith("/editMessageText"));
    expect(editCalls).toHaveLength(2);
    const lastBody = JSON.parse(editCalls[1][1].body as string);
    expect(lastBody.text).toBe("first second (done)");
  });
});
