import { BaseBotAdapter } from "../../core/base-adapter.js";
import { BotApiError } from "../../core/errors.js";
import { resolveFeatureToggles } from "../../core/features.js";
import { requestJson } from "../../core/http.js";
import { TokenProvider } from "../../core/token-provider.js";
import type { AdapterCapabilities, AdapterFeatureToggles, StreamingHandle } from "../../types.js";

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
  /** 实例级开关，见 `AdapterFeatureToggles`；`streamingOutput` 默认关闭，需显式开启 */
  features?: AdapterFeatureToggles;
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
  data?: { message_id?: string };
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
    streamingOutput: true, // 通过 PATCH 更新 interactive 卡片内容实现
  };
  private readonly baseUrl: string;
  private readonly tokenProvider: TokenProvider;
  private readonly defaultReceiveIdType: FeishuReceiveIdType;
  private readonly features: Readonly<Required<AdapterFeatureToggles>>;

  constructor(private readonly options: FeishuAppBotOptions) {
    super();
    this.baseUrl = options.baseUrl ?? "https://open.feishu.cn/open-apis";
    this.defaultReceiveIdType = options.defaultReceiveIdType ?? "chat_id";
    this.tokenProvider = new TokenProvider(() => this.fetchTenantAccessToken());
    this.features = resolveFeatureToggles(this.platform, this.capabilities, options.features);
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
  ): Promise<FeishuMessageResponse> {
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

  /**
   * 以流式方式发送消息：先创建一张 interactive markdown 卡片作为"载体"，
   * 再通过 `PATCH /im/v1/messages/:message_id` 增量更新卡片内容模拟流式输出。
   * 飞书没有开放"编辑纯文本消息"的接口，只有 interactive 卡片支持内容更新，
   * 所以无论调用方传入什么文本，这里统一走 markdown 卡片承载（与 `sendMarkdown` 一致的协议）。
   */
  override async sendStreamingText(target: string, initialText: string): Promise<StreamingHandle> {
    if (!this.features.streamingOutput) {
      throw new Error(
        "[feishu] streamingOutput 开关未启用：构造 FeishuAppBotAdapter 时传入 features: { streamingOutput: true }",
      );
    }
    const created = await this.sendMessage(target, "interactive", this.buildStreamingCard(initialText));
    const messageId = created.data?.message_id;
    if (!messageId) {
      throw new BotApiError("feishu", "创建流式消息未返回 message_id", created);
    }
    return {
      update: (text: string) => this.patchStreamingCard(messageId, text),
      finish: (finalText?: string) =>
        finalText === undefined
          ? Promise.resolve(undefined)
          : this.patchStreamingCard(messageId, finalText),
    };
  }

  private buildStreamingCard(text: string): Record<string, unknown> {
    return {
      config: { wide_screen_mode: true },
      elements: [{ tag: "markdown", content: text }],
    };
  }

  private async patchStreamingCard(messageId: string, text: string): Promise<unknown> {
    const token = await this.tokenProvider.getToken();
    const { data, response } = await requestJson<FeishuMessageResponse>(
      `${this.baseUrl}/im/v1/messages/${messageId}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: JSON.stringify(this.buildStreamingCard(text)) }),
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
