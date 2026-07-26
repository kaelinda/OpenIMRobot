import { BaseBotAdapter } from "../../core/base-adapter.js";
import { BotApiError } from "../../core/errors.js";
import { requestJson } from "../../core/http.js";
import { withRetry } from "../../core/outbound.js";
import type { AdapterCapabilities } from "../../types.js";

export interface WeComCustomBotOptions {
  /** 群聊右键菜单添加机器人后获得的 Webhook 地址（含 key 参数） */
  webhookUrl: string;
}

interface WeComWebhookResponse {
  errcode: number;
  errmsg: string;
}

/**
 * 企业微信群机器人（Webhook）：无需审核，直接 POST 消息。
 * https://developer.work.weixin.qq.com/document/path/91770
 */
export class WeComCustomBotAdapter extends BaseBotAdapter {
  readonly platform = "wecom" as const;
  readonly capabilities: AdapterCapabilities = {
    contextualReply: false,
    proactiveSend: true,
    interactiveCards: false,
    markdown: true,
    receivesMessages: false, // Webhook 型群机器人仅支持单向推送
    streamingOutput: false, // Webhook 响应不含消息句柄，无法回查/更新已发送的消息
  };

  constructor(private readonly options: WeComCustomBotOptions) {
    super();
  }

  async sendText(_target: string, text: string, mentionedList?: string[]): Promise<unknown> {
    return this.send({
      msgtype: "text",
      text: { content: text, mentioned_list: mentionedList },
    });
  }

  async sendMarkdown(_target: string, markdown: string): Promise<unknown> {
    return this.send({ msgtype: "markdown", markdown: { content: markdown } });
  }

  private async send(payload: Record<string, unknown>): Promise<unknown> {
    // 用 withRetry 包裹传输层调用：只重试网络异常/JSON 解析失败等瞬时故障，
    // 不重试下面基于已解析响应判断出的业务错误（errcode !== 0），避免把确定性错误当瞬时故障重试。
    const { data, response } = await withRetry(
      () =>
        requestJson<WeComWebhookResponse>(this.options.webhookUrl, {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      { maxAttempts: 3, baseDelayMs: 150, maxDelayMs: 1000 },
    );
    if (!response.ok || data.errcode !== 0) {
      throw new BotApiError("wecom", data.errmsg ?? `HTTP ${response.status}`, data);
    }
    return data;
  }
}
