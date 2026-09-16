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
