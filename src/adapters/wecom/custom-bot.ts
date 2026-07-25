import { BaseBotAdapter } from "../../core/base-adapter.js";
import { BotApiError } from "../../core/errors.js";
import { requestJson } from "../../core/http.js";

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
    const { data, response } = await requestJson<WeComWebhookResponse>(
      this.options.webhookUrl,
      { method: "POST", body: JSON.stringify(payload) },
    );
    if (!response.ok || data.errcode !== 0) {
      throw new BotApiError("wecom", data.errmsg ?? `HTTP ${response.status}`, data);
    }
    return data;
  }
}
