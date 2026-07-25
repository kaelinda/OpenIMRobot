/**
 * 出站发送保护：平台级限流 + 指数退避/抖动重试 + 熔断（评审意见 #7）。
 * Adapter 的 send/reply 实现应包裹在此工具之下，而不仅依赖入站限流。
 */
export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** 判断错误是否可重试；默认所有错误都可重试 */
  isRetryable?: (error: unknown) => boolean;
  /** 从错误中提取平台返回的 Retry-After（毫秒），优先于指数退避 */
  retryAfterMs?: (error: unknown) => number | undefined;
}

function jitter(delayMs: number): number {
  return Math.floor(delayMs * (0.5 + Math.random() * 0.5));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < options.maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt += 1;
      const retryable = options.isRetryable?.(error) ?? true;
      if (!retryable || attempt >= options.maxAttempts) {
        break;
      }
      const retryAfter = options.retryAfterMs?.(error);
      const backoff = Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs);
      const delay = retryAfter ?? jitter(backoff);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  openDurationMs: number;
}

/** 简单熔断器：连续失败达到阈值后短路一段时间，避免对故障平台持续重试放大故障。 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  getState(): CircuitState {
    if (this.state === "open" && Date.now() - this.openedAt >= this.options.openDurationMs) {
      this.state = "half_open";
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.getState() === "open") {
      throw new Error("circuit breaker is open, rejecting call");
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }
}
