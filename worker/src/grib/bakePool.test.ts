import {
  bakeScalar as poolScalar,
  bakeVector as poolVector,
  bakePoolStats,
  shutdownBakePool,
} from "./bakePool";
import { bakeScalar as inlineScalar } from "./bakeScalar";
import { bakeVector as inlineVector } from "./bakeVector";

/**
 * The pool must move WHERE the bake runs, never WHAT it computes. These compare
 * the pool's output, byte for byte, to the inline bake.
 *
 * IMPORTANT about coverage: under Jest the worker thread often can't host (Jest's
 * module runtime is not ts-node), so the pool falls back to inline — which is
 * exactly the safety these assertions guard. They therefore prove CORRECTNESS and
 * FALLBACK-SAFETY, not that the offload happened. That the worker thread genuinely
 * serves bakes (worker>0, inline=0, byte-identical) is proven separately and in
 * BOTH runtimes by `yarn prove:bakepool` (ts-node) and the same script compiled
 * (node dist) — because only a real ts-node/node process, not Jest, hosts the
 * worker the live app uses.
 */
const W = 16;
const H = 8;
const grid = (seed: number) => {
  const a = new Float32Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = 280 + ((i * seed) % 40); // ~Kelvin range
  return a;
};

afterAll(async () => {
  await shutdownBakePool();
});

describe("bakePool — worker-thread bake matches the inline bake", () => {
  it("scalar: pool result is identical to inline", async () => {
    const args = { variableId: "temp", values: grid(7), width: W, height: H, preRolled: true };

    const [pooled, inline] = await Promise.all([
      poolScalar({ ...args, values: grid(7) }),
      inlineScalar({ ...args, values: grid(7) }),
    ]);

    expect(pooled.imageUnscale).toEqual(inline.imageUnscale);
    expect(pooled.domain).toEqual(inline.domain);
    expect(Buffer.compare(pooled.buffer, inline.buffer)).toBe(0);
  }, 30_000);

  it("vector: pool result is identical to inline", async () => {
    const base = { variableId: "wind", width: W, height: H, preRolled: true as const };

    const [pooled, inline] = await Promise.all([
      poolVector({ ...base, u: grid(3), v: grid(5) }),
      inlineVector({ ...base, u: grid(3), v: grid(5) }),
    ]);

    expect(Buffer.compare(pooled.buffer, inline.buffer)).toBe(0);
  }, 30_000);

  it("runs several concurrent bakes through the pool without crossing results", async () => {
    // Concurrency is the whole point — the id routing must not swap two answers.
    const ids = ["temp", "humidity", "pressure", "gust", "temp", "humidity"];
    const pooled = await Promise.all(
      ids.map((variableId, i) => poolScalar({ variableId, values: grid(i + 1), width: W, height: H, preRolled: true })),
    );
    const inline = await Promise.all(
      ids.map((variableId, i) => inlineScalar({ variableId, values: grid(i + 1), width: W, height: H, preRolled: true })),
    );

    for (let i = 0; i < ids.length; i++) {
      expect(Buffer.compare(pooled[i].buffer, inline[i].buffer)).toBe(0);
    }
    // Every bake is accounted for as either worker- or inline-served — no task is
    // silently dropped, whichever runtime hosted it.
    const s = bakePoolStats();
    expect(s.worker + s.inline).toBeGreaterThanOrEqual(ids.length);
  }, 30_000);
});
