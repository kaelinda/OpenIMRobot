import { BotApiError } from "./errors.js";

export interface JsonRequestResult<T> {
  response: Response;
  data: T;
}

/**
 * 发起 HTTP 请求并解析 JSON 响应体。各平台业务错误码（如飞书 code、企微/钉钉 errcode）
 * 由调用方结合平台语义自行判断，这里只负责传输层与 JSON 解析。
 */
export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<JsonRequestResult<T>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  let data: T;
  try {
    data = (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new BotApiError(
      "http",
      `响应不是合法 JSON（HTTP ${response.status}）: ${text.slice(0, 200)}`,
    );
  }
  return { response, data };
}
