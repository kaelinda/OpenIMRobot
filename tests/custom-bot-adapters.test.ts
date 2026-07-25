import { afterEach, describe, expect, it, vi } from "vitest";
import { FeishuCustomBotAdapter } from "../src/adapters/feishu/custom-bot.js";
import { DingTalkCustomBotAdapter } from "../src/adapters/dingtalk/custom-bot.js";
import { WeComCustomBotAdapter } from "../src/adapters/wecom/custom-bot.js";
import { BotApiError } from "../src/core/errors.js";

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FeishuCustomBotAdapter", () => {
  it("发送文本消息成功", async () => {
    vi.stubGlobal("fetch", mockFetch({ code: 0, msg: "success" }));
    const bot = new FeishuCustomBotAdapter({ webhookUrl: "https://open.feishu.cn/webhook/xxx" });

    const result = await bot.sendText("_", "你好");

    expect(result).toEqual({ code: 0, msg: "success" });
  });

  it("业务错误码非 0 时抛出 BotApiError", async () => {
    vi.stubGlobal("fetch", mockFetch({ code: 19021, msg: "invalid param" }));
    const bot = new FeishuCustomBotAdapter({ webhookUrl: "https://open.feishu.cn/webhook/xxx" });

    await expect(bot.sendText("_", "你好")).rejects.toThrow(BotApiError);
  });

  it("配置 secret 时会附带 timestamp 与 sign", async () => {
    const fetchMock = mockFetch({ code: 0, msg: "success" });
    vi.stubGlobal("fetch", fetchMock);
    const bot = new FeishuCustomBotAdapter({
      webhookUrl: "https://open.feishu.cn/webhook/xxx",
      secret: "test-secret",
    });

    await bot.sendText("_", "你好");

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.timestamp).toBeTypeOf("number");
    expect(sentBody.sign).toBeTypeOf("string");
  });
});

describe("DingTalkCustomBotAdapter", () => {
  it("带 secret 时会在 URL 附加签名参数", async () => {
    const fetchMock = mockFetch({ errcode: 0, errmsg: "ok" });
    vi.stubGlobal("fetch", fetchMock);
    const bot = new DingTalkCustomBotAdapter({
      webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=xxx",
      secret: "SEC000000",
    });

    await bot.sendText("_", "你好");

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("timestamp=");
    expect(calledUrl).toContain("sign=");
  });

  it("errcode 非 0 时抛出 BotApiError", async () => {
    vi.stubGlobal("fetch", mockFetch({ errcode: 300001, errmsg: "keywords not match" }));
    const bot = new DingTalkCustomBotAdapter({
      webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=xxx",
    });

    await expect(bot.sendText("_", "你好")).rejects.toThrow(BotApiError);
  });
});

describe("WeComCustomBotAdapter", () => {
  it("发送 markdown 消息成功", async () => {
    vi.stubGlobal("fetch", mockFetch({ errcode: 0, errmsg: "ok" }));
    const bot = new WeComCustomBotAdapter({
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
    });

    const result = await bot.sendMarkdown("_", "**hello**");

    expect(result).toEqual({ errcode: 0, errmsg: "ok" });
  });

  it("HTTP 非 2xx 时抛出 BotApiError", async () => {
    vi.stubGlobal("fetch", mockFetch({ errcode: 0, errmsg: "ok" }, false, 500));
    const bot = new WeComCustomBotAdapter({
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
    });

    await expect(bot.sendText("_", "你好")).rejects.toThrow(BotApiError);
  });
});
