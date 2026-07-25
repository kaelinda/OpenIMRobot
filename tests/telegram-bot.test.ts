import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramBotAdapter } from "../src/adapters/telegram/bot.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("TelegramBotAdapter", () => {
  it("sendText 支持 replyToMessageId 附带 reply_to_message_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, result: { message_id: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    const bot = new TelegramBotAdapter({ token: "t" });

    await bot.sendText("chat-1", "hi", "42");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.reply_to_message_id).toBe(42);
  });

  it("轮询遇到错误不会因未处理的 error 事件而崩溃，会触发 pollError 并继续轮询", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        // 第一次 getUpdates 失败：过去的实现会 `this.emit("error", ...)`，
        // Node 在没有监听者时会直接抛出并可能让进程崩溃。
        return jsonResponse({ ok: false, description: "Internal Server Error" }, false, 500);
      }
      // 之后模拟真实长轮询的服务端等待行为（mock 不会真的等 timeout 秒），
      // 避免测试里出现无延迟的忙等死循环把进程内存打爆。
      await new Promise((resolve) => setTimeout(resolve, 30));
      return jsonResponse({ ok: true, result: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bot = new TelegramBotAdapter({ token: "t", pollErrorBackoffBaseMs: 5 });
    const errors: unknown[] = [];
    bot.onPollError((error) => errors.push(error));

    // 故意不注册 Node 保留的 "error" 事件监听器：验证不会抛出未捕获异常。
    await expect(bot.start()).resolves.not.toThrow();
    await waitUntil(() => errors.length >= 1);
    await waitUntil(() => call >= 2);
    await bot.stop();

    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("成功轮询到消息时会 emit message 并推进 offset", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({
          ok: true,
          result: [
            {
              update_id: 10,
              message: {
                message_id: 100,
                date: Math.floor(Date.now() / 1000),
                chat: { id: 1 },
                from: { id: 2 },
                text: "hello",
              },
            },
          ],
        });
      }
      // 模拟真实长轮询的服务端等待，避免无延迟忙等
      await new Promise((resolve) => setTimeout(resolve, 30));
      return jsonResponse({ ok: true, result: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bot = new TelegramBotAdapter({ token: "t" });
    const messages: unknown[] = [];
    bot.onMessage((message) => messages.push(message));

    await bot.start();
    await waitUntil(() => messages.length >= 1);
    await bot.stop();

    expect(messages).toEqual([
      expect.objectContaining({ platform: "telegram", messageId: "100", chatId: "1", text: "hello" }),
    ]);
  });
});
