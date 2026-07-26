import { BaseBotAdapter } from "../../core/base-adapter.js";
import { BotApiError } from "../../core/errors.js";
import { requestJson } from "../../core/http.js";
import { TokenProvider } from "../../core/token-provider.js";
import type { AdapterCapabilities } from "../../types.js";

export interface QQBotOptions {
  appId: string;
  clientSecret: string;
  /** 群/频道消息 API 基础地址 */
  baseUrl?: string;
}

interface QQAccessTokenResponse {
  access_token?: string;
  expires_in?: string;
  code?: number;
  message?: string;
}

interface QQMessageResponse {
  code?: number;
  message?: string;
}

/**
 * QQ 机器人（QQ 开放平台）：仅实现主动发送群消息的基础能力。
 * 接收消息依赖官方 WebSocket 网关鉴权与心跳协议，复杂度远高于发送，
 * 未纳入本次基础版本范围，架构上通过 BaseBotAdapter.start()/stop() 预留扩展点。
 * https://bot.q.qq.com/wiki/develop/api-v2/
 */
export class QQBotAdapter extends BaseBotAdapter {
  readonly platform = "qq" as const;
  readonly capabilities: AdapterCapabilities = {
    contextualReply: false,
    proactiveSend: true,
    interactiveCards: false,
    markdown: false,
    receivesMessages: false, // 依赖官方 WebSocket 网关，未纳入本版本
    streamingOutput: false, // 未实现消息编辑/撤回，当前只支持一次性发送
  };
  private readonly baseUrl: string;
  private readonly tokenProvider: TokenProvider;

  constructor(private readonly options: QQBotOptions) {
    super();
    this.baseUrl = options.baseUrl ?? "https://api.sgroup.qq.com";
    this.tokenProvider = new TokenProvider(() => this.fetchAccessToken());
  }

  async sendText(groupOpenId: string, text: string): Promise<unknown> {
    return this.sendGroupMessage(groupOpenId, { content: text, msg_type: 0 });
  }

  private async sendGroupMessage(
    groupOpenId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const token = await this.tokenProvider.getToken();
    const { data, response } = await requestJson<QQMessageResponse>(
      `${this.baseUrl}/v2/groups/${groupOpenId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `QQBot ${token}` },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok || (data.code !== undefined && data.code !== 0)) {
      throw new BotApiError("qq", data.message ?? `HTTP ${response.status}`, data);
    }
    return data;
  }

  private async fetchAccessToken(): Promise<{ token: string; expiresInSeconds: number }> {
    const { data, response } = await requestJson<QQAccessTokenResponse>(
      "https://bots.qq.com/app/getAppAccessToken",
      {
        method: "POST",
        body: JSON.stringify({
          appId: this.options.appId,
          clientSecret: this.options.clientSecret,
        }),
      },
    );
    if (!response.ok || !data.access_token) {
      throw new BotApiError("qq", data.message ?? `HTTP ${response.status}`, data);
    }
    return { token: data.access_token, expiresInSeconds: Number(data.expires_in ?? 7200) };
  }
}
