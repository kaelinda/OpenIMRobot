import { createHmac } from "node:crypto";
import { BaseBotAdapter } from "../../core/base-adapter.js";
import { BotApiError } from "../../core/errors.js";
import { requestJson } from "../../core/http.js";
import type { AdapterCapabilities } from "../../types.js";

export interface DingTalkCustomBotOptions {
  /** 群设置中添加自定义机器人后获得的 Webhook 地址（含 access_token 参数） */
  webhookUrl: string;
  /** 可选的加签密钥（安全设置三选一：加签 / 关键词 / IP 段），此处仅实现加签 */
  secret?: string;
}

interface DingTalkWebhookResponse {
  errcode: number;
  errmsg: string;
}

/**
 * 钉钉自定义机器人（群 Webhook）：仅支持单向推送。
 * https://open.dingtalk.com/document/robots/custom-robot-access
 */
export class DingTalkCustomBotAdapter extends BaseBotAdapter {
  readonly platform = "dingtalk" as const;
  readonly capabilities: AdapterCapabilities = {
    contextualReply: false,
    proactiveSend: true,
    interactiveCards: false,
    markdown: true,
    receivesMessages: false, // Webhook 型自定义机器人仅支持单向推送
  };

  constructor(private readonly options: DingTalkCustomBotOptions) {
    super();
  }

  async sendText(_target: string, text: string, atMobiles?: string[]): Promise<unknown> {
    return this.send({
      msgtype: "text",
      text: { content: text },
      at: atMobiles ? { atMobiles, isAtAll: false } : undefined,
    });
  }

  async sendMarkdown(_target: string, markdown: string, title = ""): Promise<unknown> {
    return this.send({
      msgtype: "markdown",
      markdown: { title, text: markdown },
    });
  }

  private buildSignedUrl(): string {
    if (!this.options.secret) {
      return this.options.webhookUrl;
    }
    const timestamp = Date.now();
    const stringToSign = `${timestamp}\n${this.options.secret}`;
    const sign = createHmac("sha256", this.options.secret)
      .update(stringToSign)
      .digest("base64");
    const separator = this.options.webhookUrl.includes("?") ? "&" : "?";
    return `${this.options.webhookUrl}${separator}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
  }

  private async send(payload: Record<string, unknown>): Promise<unknown> {
    const { data, response } = await requestJson<DingTalkWebhookResponse>(
      this.buildSignedUrl(),
      { method: "POST", body: JSON.stringify(payload) },
    );
    if (!response.ok || data.errcode !== 0) {
      throw new BotApiError("dingtalk", data.errmsg ?? `HTTP ${response.status}`, data);
    }
    return data;
  }
}
