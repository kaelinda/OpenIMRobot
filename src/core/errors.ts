/**
 * 统一的机器人 API 错误类型，携带平台标识与原始响应体便于排查。
 */
export class BotApiError extends Error {
  constructor(
    public readonly platform: string,
    message: string,
    public readonly raw?: unknown,
  ) {
    super(`[${platform}] ${message}`);
    this.name = "BotApiError";
  }
}
