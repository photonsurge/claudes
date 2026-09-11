/**
 * Pure DSP helpers for the audio bed — no AudioContext, so they are unit-testable.
 */

/** Below this input level the ceiling curve is the identity (no colouring). */
export const CEILING_KNEE = 0.8;
/** Hard maximum the ceiling curve can emit (≈ -0.45 dBFS); nothing past it. */
export const CEILING_MAX = 0.95;

/**
 * WaveShaper curve for the master "ceiling": identity below the knee, then a
 * tanh bend that never exceeds CEILING_MAX. The DynamicsCompressor ahead of it
 * is soft-kneed and adds automatic makeup gain, so it is not a brickwall — this
 * curve guarantees the signal handed to the output can't hard-clip.
 */
export function softClipCurve(n = 4096, knee = CEILING_KNEE, ceiling = CEILING_MAX): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(n);
  const span = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= knee ? x : Math.sign(x) * (knee + span * Math.tanh((a - knee) / span));
  }
  return curve;
}

/** White-noise floor under the vinyl texture. */
export const CRACKLE_HISS = 0.012;
/** Mean pop rate — expressed per second so density doesn't scale with sampleRate. */
export const CRACKLE_POPS_PER_SEC = 6;
/** Loudest single pop, pre-bus. */
export const CRACKLE_POP_PEAK = 0.2;

/**
 * Fill a buffer with vinyl surface noise: a quiet hiss plus sparse pops, each a
 * short decaying tick (2–5 samples) rather than a single-sample delta. Pops
 * arrive at CRACKLE_POPS_PER_SEC on average whatever the sample rate.
 */
export function fillCrackle(d: Float32Array, sampleRate: number, rnd: () => number = Math.random): Float32Array {
  const p = CRACKLE_POPS_PER_SEC / sampleRate;
  for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * CRACKLE_HISS;
  for (let i = 0; i < d.length; i++) {
    if (rnd() >= p) continue;
    const amp = (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() * 0.7) * CRACKLE_POP_PEAK;
    const len = 2 + ((rnd() * 4) | 0);
    for (let k = 0; k < len && i + k < d.length; k++) d[i + k] += amp * Math.pow(0.5, k);
  }
  return d;
}

/** Mean raindrop rate for the rain texture, per second (sample-rate independent). */
export const RAIN_DROPS_PER_SEC = 140;
/** Loudest single drop, pre-bus. */
export const RAIN_DROP_PEAK = 0.22;

/**
 * Fill a buffer with a rain texture: a faint hiss plus dense short drops, each
 * a few milliseconds of decaying noise. Looped at low level behind wet scenes.
 */
export function fillRain(d: Float32Array, sampleRate: number, rnd: () => number = Math.random): Float32Array {
  const p = RAIN_DROPS_PER_SEC / sampleRate;
  for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * 0.006;
  for (let i = 0; i < d.length; i++) {
    if (rnd() >= p) continue;
    const amp = (0.2 + rnd() * 0.8) * RAIN_DROP_PEAK;
    const len = Math.floor(sampleRate * (0.003 + rnd() * 0.006));
    const k = Math.pow(0.01, 1 / len);
    let env = amp;
    for (let j = 0; j < len && i + j < d.length; j++) {
      d[i + j] += (rnd() * 2 - 1) * env;
      env *= k;
    }
  }
  return d;
}
