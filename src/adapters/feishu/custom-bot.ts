import { createHmac } from "node:crypto";
import { BaseBotAdapter } from "../../core/base-adapter.js";
import { BotApiError } from "../../core/errors.js";
import { requestJson } from "../../core/http.js";
import type { AdapterCapabilities } from "../../types.js";

export interface FeishuCustomBotOptions {
  /** 群设置中添加自定义机器人后获得的 Webhook 地址 */
  webhookUrl: string;
  /** 可选的加签密钥（自定义机器人安全设置） */
  secret?: string;
}

interface FeishuWebhookResponse {
  code?: number;
  msg?: string;
  StatusCode?: number;
  StatusMessage?: string;
}

/**
 * 飞书自定义机器人（群 Webhook）：仅支持单向推送，无需应用审核。
 * https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 */
export class FeishuCustomBotAdapter extends BaseBotAdapter {
  readonly platform = "feishu" as const;
  readonly capabilities: AdapterCapabilities = {
    contextualReply: false,
    proactiveSend: true,
    interactiveCards: true,
    markdown: true,
    receivesMessages: false, // Webhook 型自定义机器人仅支持单向推送
  };

  constructor(private readonly options: FeishuCustomBotOptions) {
    super();
  }

  async sendText(_target: string, text: string): Promise<unknown> {
    return this.send({ msg_type: "text", content: { text } });
  }

  async sendMarkdown(_target: string, markdown: string): Promise<unknown> {
    // 飞书没有 msg_type: "post" + tag: "md" 这种组合：post 富文本消息的 element tag
    // 是 text/a/at/img 等，不支持 markdown；markdown 渲染需要走 interactive 卡片的
    // markdown 元素（与 FeishuAppBotAdapter.sendMarkdown 保持一致）。
    return this.sendCard({
      config: { wide_screen_mode: true },
      elements: [{ tag: "markdown", content: markdown }],
    });
  }

  async sendCard(card: Record<string, unknown>): Promise<unknown> {
    return this.send({ msg_type: "interactive", card });
  }

  private sign(timestamp: number): string {
    const stringToSign = `${timestamp}\n${this.options.secret}`;
    return createHmac("sha256", stringToSign).update("").digest("base64");
  }

  private async send(payload: Record<string, unknown>): Promise<unknown> {
    const body: Record<string, unknown> = { ...payload };
    if (this.options.secret) {
      const timestamp = Math.floor(Date.now() / 1000);
      body.timestamp = timestamp;
      body.sign = this.sign(timestamp);
    }
    const { data, response } = await requestJson<FeishuWebhookResponse>(
      this.options.webhookUrl,
      { method: "POST", body: JSON.stringify(body) },
    );
    const code = data.code ?? data.StatusCode ?? 0;
    if (!response.ok || code !== 0) {
      throw new BotApiError(
        "feishu",
        data.msg ?? data.StatusMessage ?? `HTTP ${response.status}`,
        data,
      );
    }
    return data;
  }
}
