import { BaseBotAdapter } from "../../core/base-adapter.js";
import { BotApiError } from "../../core/errors.js";
import { requestJson } from "../../core/http.js";
import { TokenProvider } from "../../core/token-provider.js";
import type { AdapterCapabilities } from "../../types.js";

export type FeishuReceiveIdType =
  | "chat_id"
  | "open_id"
  | "user_id"
  | "union_id"
  | "email";

export interface FeishuAppBotOptions {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  /** 发送消息时 target 的含义，默认按群 chat_id 发送 */
  defaultReceiveIdType?: FeishuReceiveIdType;
}

interface FeishuTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuMessageResponse {
  code: number;
  msg: string;
  data?: unknown;
}

/**
 * 飞书自建应用机器人：AppID/AppSecret 换取 tenant_access_token 后调用消息发送接口。
 * https://open.feishu.cn/document/server-docs/im-v1/message/create
 */
export class FeishuAppBotAdapter extends BaseBotAdapter {
  readonly platform = "feishu" as const;
  readonly capabilities: AdapterCapabilities = {
    contextualReply: false,
    proactiveSend: true,
    interactiveCards: true,
    markdown: true,
    receivesMessages: false, // 本版本未实现事件订阅回调，见 README
  };
  private readonly baseUrl: string;
  private readonly tokenProvider: TokenProvider;
  private readonly defaultReceiveIdType: FeishuReceiveIdType;

  constructor(private readonly options: FeishuAppBotOptions) {
    super();
    this.baseUrl = options.baseUrl ?? "https://open.feishu.cn/open-apis";
    this.defaultReceiveIdType = options.defaultReceiveIdType ?? "chat_id";
    this.tokenProvider = new TokenProvider(() => this.fetchTenantAccessToken());
  }

  async sendText(target: string, text: string): Promise<unknown> {
    return this.sendMessage(target, "text", { text });
  }

  async sendMarkdown(target: string, markdown: string): Promise<unknown> {
    return this.sendMessage(target, "interactive", {
      config: { wide_screen_mode: true },
      elements: [{ tag: "markdown", content: markdown }],
    });
  }

  private async sendMessage(
    receiveId: string,
    msgType: string,
    content: Record<string, unknown>,
  ): Promise<unknown> {
    const token = await this.tokenProvider.getToken();
    const { data, response } = await requestJson<FeishuMessageResponse>(
      `${this.baseUrl}/im/v1/messages?receive_id_type=${this.defaultReceiveIdType}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: msgType,
          content: JSON.stringify(content),
        }),
      },
    );
    if (!response.ok || data.code !== 0) {
      throw new BotApiError("feishu", data.msg ?? `HTTP ${response.status}`, data);
    }
    return data;
  }

  private async fetchTenantAccessToken(): Promise<{
    token: string;
    expiresInSeconds: number;
  }> {
    const { data, response } = await requestJson<FeishuTokenResponse>(
      `${this.baseUrl}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        body: JSON.stringify({
          app_id: this.options.appId,
          app_secret: this.options.appSecret,
        }),
      },
    );
    if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
      throw new BotApiError("feishu", data.msg ?? `HTTP ${response.status}`, data);
    }
    return { token: data.tenant_access_token, expiresInSeconds: data.expire ?? 7200 };
  }
}
