"use client";

/**
 * WeatherLayers' ParticleLayer with its transform-feedback state kept ALIVE
 * across `visible: false`.
 *
 * Upstream (2026.5) tears the particle buffers down the moment the layer goes
 * invisible and rebuilds them when it comes back: four GPU buffers of
 * numParticles × maxAge × (3+3+4+4) floats plus a JS array of the same length —
 * ~25 MB for the dense preset — allocated, uploaded and then scavenged, 30–60 ms
 * of main thread plus 20–40 ms of GC on the cut that turns wind on
 * (docs/watch-perf-plan.md, round 54). The director's looks flip wind on and
 * off with nearly every map type, so that was most cuts.
 *
 * deck already skips draw() — and with it the per-frame step — for an invisible
 * layer, so nothing needs the buffers gone. This subclass patches the inner
 * line layer's `updateState` to mirror upstream's exactly, minus the `visible`
 * term: the transform is set up once, rebuilt only when its SHAPE changes
 * (imageType / numParticles / maxAge / width), deleted only when the shape is
 * invalid or the layer is finalized. A build whose internals don't match what
 * this expects is left untouched — upstream behaviour, just the rebuild cost.
 *
 * The inner class isn't exported, so it is patched from the first sublayer the
 * composite renders — once, on the prototype, for every particle layer.
 */
import { ImageType, ParticleLayer } from "weatherlayers-gl";

type ShapeProps = { imageType?: unknown; numParticles?: number; maxAge?: number; width?: number; palette?: unknown };
type UpdateParams = { props: ShapeProps; oldProps: ShapeProps };

/** The props that size the particle buffers — a change means a rebuild. */
export function particleShapeChanged(props: ShapeProps, oldProps: ShapeProps): boolean {
  return (
    props.imageType !== oldProps.imageType ||
    props.numParticles !== oldProps.numParticles ||
    props.maxAge !== oldProps.maxAge ||
    props.width !== oldProps.width
  );
}

/** What this relies on of the inner layer (WeatherLayers 2026.5's particle-line layer). */
interface ParticleInner {
  state: { initialized?: boolean };
  _setupTransformFeedback(): void;
  _deleteTransformFeedback(): void;
  _updatePalette(): void;
}
type UpdateState = (this: ParticleInner, params: UpdateParams) => void;

/**
 * Upstream's updateState without the `visible` term. `superUpdateState` is the
 * inner layer's parent (deck's LineLayer) updateState, which upstream calls first.
 */
export function keepAliveUpdateState(this: ParticleInner, params: UpdateParams, superUpdateState: UpdateState): void {
  superUpdateState.call(this, params);
  const { imageType, numParticles, maxAge, width, palette } = params.props;
  if (imageType === ImageType.VECTOR && numParticles && maxAge && width) {
    if (!this.state.initialized || particleShapeChanged(params.props, params.oldProps)) this._setupTransformFeedback();
    if (palette !== params.oldProps.palette) this._updatePalette();
  } else {
    this._deleteTransformFeedback();
  }
}

const seen = new WeakSet<object>();

/**
 * Install the keep-alive `updateState` on an inner particle layer's prototype.
 * True when installed; false when already handled or the build is unfamiliar
 * (missing any hook it needs — then upstream's updateState stays in place).
 */
export function patchParticleInner(proto: object): boolean {
  if (seen.has(proto)) return false;
  seen.add(proto);
  const p = proto as Partial<ParticleInner>;
  const parent = Object.getPrototypeOf(proto) as { updateState?: unknown } | null;
  if (
    typeof p._setupTransformFeedback !== "function" ||
    typeof p._deleteTransformFeedback !== "function" ||
    typeof p._updatePalette !== "function" ||
    typeof parent?.updateState !== "function"
  ) {
    return false;
  }
  const superUpdateState = parent.updateState as UpdateState;
  (proto as { updateState: UpdateState }).updateState = function (this: ParticleInner, params: UpdateParams) {
    keepAliveUpdateState.call(this, params, superUpdateState);
  };
  return true;
}

export class KeepAliveParticleLayer extends ParticleLayer {
  static layerName = "KeepAliveParticleLayer";

  renderLayers(): ReturnType<ParticleLayer["renderLayers"]> {
    const out = super.renderLayers();
    const list = (Array.isArray(out) ? out : [out]) as unknown[];
    for (const l of list) if (l && typeof l === "object" && !Array.isArray(l)) patchParticleInner(Object.getPrototypeOf(l));
    return out;
  }
}
