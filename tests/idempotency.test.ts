import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "../src/core/idempotency.js";

describe("InMemoryIdempotencyStore", () => {
  it("grants processing lease on first acquire", async () => {
    const store = new InMemoryIdempotencyStore();
    const result = await store.acquire("k1", 1000);
    expect(result.acquired).toBe(true);
    expect(result.alreadySucceeded).toBe(false);
    expect(result.record.attempts).toBe(1);
  });

  it("rejects concurrent acquire while lease is held", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.acquire("k1", 1000);
    const second = await store.acquire("k1", 1000);
    expect(second.acquired).toBe(false);
    expect(second.alreadySucceeded).toBe(false);
  });

  it("short-circuits with alreadySucceeded after markSucceeded, never re-acquirable", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.acquire("k1", 1000);
    await store.markSucceeded("k1");

    const result = await store.acquire("k1", 1000);
    expect(result.acquired).toBe(false);
    expect(result.alreadySucceeded).toBe(true);
  });

  it("allows re-acquire after markFailed, enabling at-least-once retry", async () => {
    const store = new InMemoryIdempotencyStore();
    const first = await store.acquire("k1", 1000);
    expect(first.acquired).toBe(true);
    await store.markFailed("k1");

    const retry = await store.acquire("k1", 1000);
    expect(retry.acquired).toBe(true);
    expect(retry.alreadySucceeded).toBe(false);
    expect(retry.record.attempts).toBe(2);
  });

  it("allows re-acquire once the lease naturally expires (crash recovery)", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.acquire("k1", 5);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const result = await store.acquire("k1", 1000);
    expect(result.acquired).toBe(true);
  });
});
