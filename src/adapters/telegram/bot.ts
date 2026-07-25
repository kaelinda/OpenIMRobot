import { BaseBotAdapter } from "../../core/base-adapter.js";
import { BotApiError } from "../../core/errors.js";
import { requestJson } from "../../core/http.js";
import type { IncomingMessage } from "../../types.js";

export interface TelegramBotOptions {
  /** BotFather 签发的 Bot Token */
  token: string;
  baseUrl?: string;
  /** getUpdates 长轮询的服务端等待秒数，默认 30 秒 */
  pollingTimeoutSeconds?: number;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    chat: { id: number };
    from?: { id: number };
    text?: string;
  };
}

/**
 * Telegram Bot API：sendMessage 发送 + getUpdates 长轮询接收。
 * https://core.telegram.org/bots/api
 */
export class TelegramBotAdapter extends BaseBotAdapter {
  readonly platform = "telegram" as const;
  private readonly baseUrl: string;
  private offset = 0;
  private polling = false;
  private pollLoop?: Promise<void>;

  constructor(private readonly options: TelegramBotOptions) {
    super();
    this.baseUrl = options.baseUrl ?? `https://api.telegram.org/bot${options.token}`;
  }

  async sendText(chatId: string, text: string): Promise<unknown> {
    return this.call("sendMessage", { chat_id: chatId, text });
  }

  override async start(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    this.pollLoop = this.runPollLoop();
  }

  override async stop(): Promise<void> {
    this.polling = false;
    await this.pollLoop;
  }

  private async runPollLoop(): Promise<void> {
    const timeout = this.options.pollingTimeoutSeconds ?? 30;
    while (this.polling) {
      try {
        const updates = await this.call<TelegramUpdate[]>("getUpdates", {
          offset: this.offset,
          timeout,
        });
        for (const update of updates) {
          this.offset = update.update_id + 1;
          if (update.message?.text) {
            const message: IncomingMessage = {
              platform: this.platform,
              messageId: String(update.message.message_id),
              chatId: String(update.message.chat.id),
              senderId: update.message.from ? String(update.message.from.id) : undefined,
              text: update.message.text,
              timestamp: update.message.date * 1000,
              raw: update,
            };
            this.emitMessage(message);
          }
        }
      } catch (error) {
        this.emit("error", error);
      }
    }
  }

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const { data, response } = await requestJson<TelegramApiResponse<T>>(
      `${this.baseUrl}/${method}`,
      { method: "POST", body: JSON.stringify(payload) },
    );
    if (!response.ok || !data.ok) {
      throw new BotApiError("telegram", data.description ?? `HTTP ${response.status}`, data);
    }
    return data.result as T;
  }
}
