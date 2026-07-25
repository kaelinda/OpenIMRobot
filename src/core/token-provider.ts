export interface FetchedToken {
  token: string;
  expiresInSeconds: number;
}

export interface TokenProviderOptions {
  /** 提前多少秒视为过期并刷新，默认 60 秒，规避临界值请求刚好失效 */
  refreshBufferSeconds?: number;
}

/**
 * 通用的 Token 缓存与刷新器：飞书 tenant_access_token、钉钉 access_token、
 * 企业微信 access_token、QQ access_token 均为“有效期内可复用、需自行缓存”的模式，
 * 用同一套逻辑避免各平台重复实现且都要处理并发刷新问题。
 */
export class TokenProvider {
  private token?: string;
  private expiresAt = 0;
  private pending?: Promise<string>;
  private readonly refreshBufferMs: number;

  constructor(
    private readonly fetcher: () => Promise<FetchedToken>,
    options: TokenProviderOptions = {},
  ) {
    this.refreshBufferMs = (options.refreshBufferSeconds ?? 60) * 1000;
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) {
      return this.token;
    }
    if (!this.pending) {
      this.pending = this.refresh().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }

  /** 强制下一次 getToken() 重新拉取（例如收到平台返回的鉴权失效错误码后调用） */
  invalidate(): void {
    this.token = undefined;
    this.expiresAt = 0;
  }

  private async refresh(): Promise<string> {
    const { token, expiresInSeconds } = await this.fetcher();
    this.token = token;
    this.expiresAt = Date.now() + expiresInSeconds * 1000 - this.refreshBufferMs;
    return token;
  }
}
