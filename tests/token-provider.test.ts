import { describe, expect, it, vi } from "vitest";
import { TokenProvider } from "../src/core/token-provider.js";

describe("TokenProvider", () => {
  it("在有效期内缓存 token，不重复拉取", async () => {
    const fetcher = vi.fn().mockResolvedValue({ token: "abc", expiresInSeconds: 7200 });
    const provider = new TokenProvider(fetcher);

    const t1 = await provider.getToken();
    const t2 = await provider.getToken();

    expect(t1).toBe("abc");
    expect(t2).toBe("abc");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("并发调用只触发一次刷新", async () => {
    let calls = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { token: `token-${calls}`, expiresInSeconds: 7200 };
    });
    const provider = new TokenProvider(fetcher);

    const [t1, t2] = await Promise.all([provider.getToken(), provider.getToken()]);

    expect(t1).toBe(t2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("invalidate 后会重新拉取 token", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ token: "first", expiresInSeconds: 7200 })
      .mockResolvedValueOnce({ token: "second", expiresInSeconds: 7200 });
    const provider = new TokenProvider(fetcher);

    const t1 = await provider.getToken();
    provider.invalidate();
    const t2 = await provider.getToken();

    expect(t1).toBe("first");
    expect(t2).toBe("second");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("过期后自动刷新", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ token: "first", expiresInSeconds: 1 })
      .mockResolvedValueOnce({ token: "second", expiresInSeconds: 7200 });
    const provider = new TokenProvider(fetcher, { refreshBufferSeconds: 0 });

    const t1 = await provider.getToken();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const t2 = await provider.getToken();

    expect(t1).toBe("first");
    expect(t2).toBe("second");
  });
});
