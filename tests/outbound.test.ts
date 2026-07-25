import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker, withRetry } from "../src/core/outbound.js";

describe("withRetry", () => {
  it("returns the result immediately on success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures up to maxAttempts then succeeds", async () => {
    let attempts = 0;
    const fn = vi.fn().mockImplementation(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return "ok";
    });

    const result = await withRetry(fn, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 });
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("throws the last error once maxAttempts is exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("permanent"));
    await expect(
      withRetry(fn, { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5 }),
    ).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry when isRetryable returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("do-not-retry"));
    await expect(
      withRetry(fn, {
        maxAttempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 5,
        isRetryable: () => false,
      }),
    ).rejects.toThrow("do-not-retry");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("CircuitBreaker", () => {
  it("opens after reaching the failure threshold and rejects fast", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, openDurationMs: 1000 });
    const failing = () => Promise.reject(new Error("boom"));

    await expect(breaker.execute(failing)).rejects.toThrow("boom");
    await expect(breaker.execute(failing)).rejects.toThrow("boom");
    expect(breaker.getState()).toBe("open");

    await expect(breaker.execute(failing)).rejects.toThrow(/circuit breaker is open/);
  });

  it("transitions to half_open after openDurationMs and closes again on success", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, openDurationMs: 20 });
    await expect(breaker.execute(() => Promise.reject(new Error("boom")))).rejects.toThrow();
    expect(breaker.getState()).toBe("open");

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(breaker.getState()).toBe("half_open");

    const result = await breaker.execute(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
    expect(breaker.getState()).toBe("closed");
  });
});
