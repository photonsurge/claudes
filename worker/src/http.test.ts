import { mapPool, fetchWithTimeout, DEFAULT_TIMEOUT_MS } from "./http";

describe("mapPool", () => {
  it("preserves input order regardless of completion order", async () => {
    const out = await mapPool([30, 10, 20, 0], 2, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 10, 20, 0]);
  });

  it("never exceeds the concurrency limit", async () => {
    let running = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // it really is running concurrently
  });

  it("runs concurrently — wall clock is far below the serial sum", async () => {
    const started = Date.now();
    await mapPool(Array.from({ length: 12 }, () => 40), 6, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
    });
    // Serial would be ~480ms; at 6-wide it's ~2 rounds of 40ms.
    expect(Date.now() - started).toBeLessThan(300);
  });

  it("handles an empty list and a limit larger than the list", async () => {
    expect(await mapPool([], 8, async () => 1)).toEqual([]);
    expect(await mapPool([1, 2], 99, async (n) => n * 2)).toEqual([2, 4]);
  });

  it("does not lose or duplicate work", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen: number[] = [];
    const out = await mapPool(items, 7, async (n) => { seen.push(n); return n; });
    expect(out).toEqual(items);
    expect([...seen].sort((a, b) => a - b)).toEqual(items);
  });
});

describe("fetchWithTimeout", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it("passes an abort signal and leaves other init untouched", async () => {
    const spy = jest.fn(async () => new Response("ok"));
    global.fetch = spy as unknown as typeof fetch;

    await fetchWithTimeout("https://example.test/x", { method: "POST", headers: { A: "b" } });

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/x");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ A: "b" });
    expect(init.signal).toBeDefined();
    expect((init as any).timeoutMs).toBeUndefined(); // not leaked to fetch
  });

  it("aborts a request that never settles", async () => {
    global.fetch = ((_url: any, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;

    await expect(fetchWithTimeout("https://example.test/hang", { timeoutMs: 20 })).rejects.toThrow("aborted");
  });

  it("has a default timeout", () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
