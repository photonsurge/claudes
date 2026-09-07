// Unit tests for the cold-start retry helper.
import { backoffDelayMs, retryUntil } from "./retry";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("backoffDelayMs", () => {
  it("doubles from the base and caps at max", () => {
    expect(backoffDelayMs(0)).toBe(2_000);
    expect(backoffDelayMs(1)).toBe(4_000);
    expect(backoffDelayMs(3)).toBe(16_000);
    expect(backoffDelayMs(4)).toBe(30_000);
    expect(backoffDelayMs(100)).toBe(30_000); // huge attempts must not overflow
  });
});

describe("retryUntil", () => {
  it("delivers a first-try value exactly once", async () => {
    const got: string[] = [];
    retryUntil(async () => "hello", (v) => got.push(v));
    await tick(5);
    expect(got).toEqual(["hello"]);
  });

  it("retries on throw and on null until a value lands", async () => {
    let calls = 0;
    const got: number[] = [];
    retryUntil(
      async () => {
        calls++;
        if (calls === 1) throw new Error("network down");
        if (calls === 2) return null; // e.g. a 5xx reported as "no manifest"
        return 42;
      },
      (v) => got.push(v),
      { baseMs: 1, maxMs: 2 },
    );
    await tick(50);
    expect(calls).toBe(3);
    expect(got).toEqual([42]);
  });

  it("cancel stops the loop and suppresses late values", async () => {
    let calls = 0;
    const got: number[] = [];
    const cancel = retryUntil<number>(
      async () => {
        calls++;
        return null; // never lands
      },
      (v) => got.push(v),
      { baseMs: 1, maxMs: 2 },
    );
    await tick(20);
    cancel();
    const callsAtCancel = calls;
    await tick(20);
    expect(calls).toBe(callsAtCancel); // no further attempts after cancel
    expect(got).toEqual([]);
  });
});
