/**
 * BreatheExtension — a deck.gl layer extension that animates a layer's alpha
 * and size on the GPU from a clock uniform, so a "breathing" glow needs NO
 * per-frame layer rebuild.
 *
 * Why: the country spotlight glow and the on-air alert highlight used to be
 * rebuilt by Globe's pulse loop at 15 Hz with fresh `opacity` /
 * `lineWidthScale` values. Every one of those commits made deck diff every
 * layer and sublayer in the stack (~2 ms a commit, 6 % of the OBS main thread
 * with a full scene on air). With this extension the layers are static: each
 * frame the extension's `draw` hook writes two floats into a uniform block and
 * asks for the next frame, and the shader scales alpha (`DECKGL_FILTER_COLOR`)
 * and width/radius (`DECKGL_FILTER_SIZE`). The breathe also runs at the full
 * frame rate instead of 15 Hz.
 *
 * Semantics match the uniform-based version exactly: `alpha` is a multiplier
 * on the baked colour alpha (deck applied pow(opacity, 1/2.2) to the old
 * `opacity` prop, so that gamma is applied here too) and `size` multiplies the
 * baked line width / radius after deck's min/max-pixel clamp — bake base widths
 * at or above the clamp so it stays inert, as before.
 */
import { LayerExtension, type Layer } from "@deck.gl/core";

export interface BreatheSpec {
  /** One full cycle, ms. Phase is wall-clock based so every layer breathes in step. */
  periodMs: number;
  /** Waveform: cosine breathe (0→1→0, default) or sawtooth ping (0→1, snap back). */
  wave?: "breathe" | "ping";
  /** Alpha multiplier at wave 0 and wave 1 (default: no change). */
  alpha?: [number, number];
  /** Line-width / radius multiplier at wave 0 and wave 1 (default: no change). */
  size?: [number, number];
}

export type BreatheProps = { breathe?: BreatheSpec | null };

const uniformBlock = /* glsl */ `\
layout(std140) uniform breatheUniforms {
  float alpha;
  float size;
} breathe;
`;

export const breatheModule = {
  name: "breathe",
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: { alpha: "f32", size: "f32" },
  inject: {
    "vs:DECKGL_FILTER_SIZE": /* glsl */ `size *= breathe.size;`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `color.a *= breathe.alpha;`,
  },
} as const;

/** The two uniforms for `spec` at wall-clock `now` (ms). */
export function breatheUniforms(spec: BreatheSpec, now: number): { alpha: number; size: number } {
  const period = spec.periodMs > 0 ? spec.periodMs : 1;
  const phase = (((now % period) + period) % period) / period;
  const w = spec.wave === "ping" ? phase : 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
  const lerp = (r: [number, number] | undefined) => (r ? r[0] + (r[1] - r[0]) * w : 1);
  return { alpha: Math.pow(Math.max(0, lerp(spec.alpha)), 1 / 2.2), size: lerp(spec.size) };
}

export class BreatheExtension extends LayerExtension {
  static extensionName = "BreatheExtension";
  /** Declared so composite layers forward `breathe` to their sublayers. */
  static defaultProps = { breathe: null };

  getShaders() {
    return { modules: [breatheModule] };
  }

  draw(this: Layer<BreatheProps>) {
    const spec = this.props.breathe;
    if (!spec) {
      this.setShaderModuleProps({ breathe: { alpha: 1, size: 1 } });
      return;
    }
    this.setShaderModuleProps({ breathe: breatheUniforms(spec, Date.now()) });
    // Keep the animation going when nothing else asks deck for a frame.
    this.setNeedsRedraw();
  }
}

/** One shared instance — extensions are stateless and deck compares them by class + opts. */
export const BREATHE = new BreatheExtension();
