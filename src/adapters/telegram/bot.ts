import { BaseBotAdapter } from "../../core/base-adapter.js";
import { BotApiError } from "../../core/errors.js";
import { resolveFeatureToggles } from "../../core/features.js";
import { requestJson } from "../../core/http.js";
import type {
  AdapterCapabilities,
  AdapterFeatureToggles,
  IncomingMessage,
  StreamingHandle,
} from "../../types.js";

export interface TelegramBotOptions {
  /** BotFather 签发的 Bot Token */
  token: string;
  baseUrl?: string;
  /** getUpdates 长轮询的服务端等待秒数，默认 30 秒 */
  pollingTimeoutSeconds?: number;
  /** 单次轮询失败后的退避基数（毫秒），默认 1000ms，指数退避+抖动，上限 30s */
  pollErrorBackoffBaseMs?: number;
  /** 实例级开关，见 `AdapterFeatureToggles`；`streamingOutput` 默认关闭，需显式开启 */
  features?: AdapterFeatureToggles;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramMessageResult {
  message_id: number;
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
  readonly capabilities: AdapterCapabilities = {
    contextualReply: true, // 支持 reply_to_message_id
    proactiveSend: true,
    interactiveCards: false,
    markdown: false, // 未设置 parse_mode，当前按纯文本发送
    receivesMessages: true, // getUpdates 长轮询
    streamingOutput: true, // 通过 editMessageText 增量更新已发送的消息实现
  };
  private readonly baseUrl: string;
  private readonly pollErrorBackoffBaseMs: number;
  private readonly features: Readonly<Required<AdapterFeatureToggles>>;
  private offset = 0;
  private polling = false;
  private pollLoop?: Promise<void>;
  private consecutiveErrors = 0;

  constructor(private readonly options: TelegramBotOptions) {
    super();
    this.baseUrl = options.baseUrl ?? `https://api.telegram.org/bot${options.token}`;
    this.pollErrorBackoffBaseMs = options.pollErrorBackoffBaseMs ?? 1000;
    this.features = resolveFeatureToggles(this.platform, this.capabilities, options.features);
  }

  /**
   * 注册轮询错误回调。Node `EventEmitter` 对保留事件名 `"error"` 有特殊语义：
   * 没有任何监听者时会直接抛出并可能让进程崩溃。这里改用自定义事件名 `"pollError"`，
   * 即使调用方不注册监听器，轮询错误也只会被内部捕获、记录、退避重试，不会终止进程。
   */
  onPollError(listener: (error: unknown) => void): this {
    this.on("pollError", listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * 发送文本消息。传入 `replyToMessageId` 时会在原消息上下文中回复（体现
   * `capabilities.contextualReply`），否则视为主动推送到 chatId。
   */
  async sendText(chatId: string, text: string, replyToMessageId?: string): Promise<unknown> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      ...(replyToMessageId ? { reply_to_message_id: Number(replyToMessageId) } : {}),
    });
  }

  /**
   * 以流式方式发送消息：先 `sendMessage` 创建一条消息，再通过 `editMessageText`
   * 增量更新同一条消息的内容模拟流式输出。
   */
  override async sendStreamingText(chatId: string, initialText: string): Promise<StreamingHandle> {
    if (!this.features.streamingOutput) {
      throw new Error(
        "[telegram] streamingOutput 开关未启用：构造 TelegramBotAdapter 时传入 features: { streamingOutput: true }",
      );
    }
    const created = await this.call<TelegramMessageResult>("sendMessage", {
      chat_id: chatId,
      text: initialText,
    });
    const messageId = created.message_id;
    return {
      update: (text: string) =>
        this.call("editMessageText", { chat_id: chatId, message_id: messageId, text }),
      finish: (finalText?: string) =>
        finalText === undefined
          ? Promise.resolve(undefined)
          : this.call("editMessageText", { chat_id: chatId, message_id: messageId, text: finalText }),
    };
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
        this.consecutiveErrors = 0;
      } catch (error) {
        this.consecutiveErrors += 1;
        this.emit("pollError", error);
        if (!this.polling) break;
        await new Promise((resolve) => setTimeout(resolve, this.backoffDelayMs()));
      }
    }
  }

  /** 指数退避 + 抖动，上限 30 秒，避免对下游持续故障进行热重试 */
  private backoffDelayMs(): number {
    const capped = Math.min(this.consecutiveErrors, 6); // 2^6 * base ≈ 64x base
    const exponential = this.pollErrorBackoffBaseMs * 2 ** (capped - 1);
    const withCap = Math.min(exponential, 30_000);
    return Math.floor(withCap * (0.5 + Math.random() * 0.5));
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
