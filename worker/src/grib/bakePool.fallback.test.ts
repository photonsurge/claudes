/**
 * The fallback path, deterministically — the thing that makes the pool "never
 * worse than before". BAKE_POOL=off is read into a load-time const, so this sets
 * it BEFORE importing the pool (own file = own module registry), then proves the
 * pool serves every bake inline, byte-identical to a direct bake, and accounts
 * for it (inline>0, worker=0). No worker thread involved — no flakiness — which is
 * exactly the degraded mode this guards.
 */
process.env.BAKE_POOL = "off";

import { bakeScalar as poolScalar, bakeVector as poolVector, bakePoolStats } from "./bakePool";
import { bakeScalar as inlineScalar } from "./bakeScalar";
import { bakeVector as inlineVector } from "./bakeVector";

const W = 16;
const H = 8;
const grid = (seed: number) => {
  const a = new Float32Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = 280 + ((i * seed) % 40);
  return a;
};

describe("bakePool — BAKE_POOL=off serves inline, identical output, accounted for", () => {
  it("scalar falls back inline, byte-identical", async () => {
    const [pooled, inline] = await Promise.all([
      poolScalar({ variableId: "temp", values: grid(7), width: W, height: H, preRolled: true }),
      inlineScalar({ variableId: "temp", values: grid(7), width: W, height: H, preRolled: true }),
    ]);
    expect(Buffer.compare(pooled.buffer, inline.buffer)).toBe(0);
  });

  it("vector falls back inline, byte-identical", async () => {
    const [pooled, inline] = await Promise.all([
      poolVector({ variableId: "wind", u: grid(3), v: grid(5), width: W, height: H, preRolled: true }),
      inlineVector({ variableId: "wind", u: grid(3), v: grid(5), width: W, height: H, preRolled: true }),
    ]);
    expect(Buffer.compare(pooled.buffer, inline.buffer)).toBe(0);
  });

  it("every bake was served inline, none by a worker", () => {
    // Two POOL calls in this file (poolScalar + poolVector); the inline* refs are
    // direct imports and don't touch the pool's counters.
    const s = bakePoolStats();
    expect(s.inline).toBeGreaterThanOrEqual(2);
    expect(s.worker).toBe(0);
  });
});
