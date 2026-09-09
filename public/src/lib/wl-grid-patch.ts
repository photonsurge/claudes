/**
 * WeatherLayers' GridLayer re-samples EVERY visible grid point on EVERY camera
 * tick (its composite's `shouldUpdateState` fires on viewportChanged, and
 * `_updatePositions` → `_updateFeatures` re-run the cubic raster lookups for the
 * whole visible set), on top of rebuilding the icosphere it forgot to cache
 * (wl-grid-positions.ts). In barbs mode that was ~12 s of a minute's main
 * thread — 300–2000 ms stalls through every fly-to (docs/watch-perf-plan.md,
 * round 25).
 *
 * Two prototype patches on the internal composite, reached through
 * `GridLayer.renderLayers` (the composite class isn't exported):
 *
 * - `_updatePositions`: the same positions from the memoised builder (globe
 *   viewports; Mercator falls through to WeatherLayers' own).
 * - `_updateFeatures`: a per-layer cache of each point's sampled feature, keyed
 *   by the point (the memoised icosphere hands out the same arrays every tick),
 *   emptied when any sampling prop changes. Only points not yet seen are
 *   sampled — by WeatherLayers' own `_updateFeatures`, run on just that subset —
 *   so the features are exactly what it would compute, in position order. A
 *   point WeatherLayers drops (NaN / out of bounds) is remembered as absent.
 *
 * Shape-guarded like the luma and deck patches; a different WeatherLayers is
 * left alone, and a composite whose features don't sit on their positions
 * hands back to the original for good.
 */
import { GridLayer } from "weatherlayers-gl";
import { globeGridPositions, type GlobeViewportLike, type LngLat } from "./wl-grid-positions";
import { godsLog } from "./globe-log";

export type PatchResult = "patched" | "already" | "skipped";

export interface GridFeature {
  geometry: { coordinates: LngLat };
  properties: { value: number };
}
interface CompositeState {
  positions?: LngLat[];
  points?: GridFeature[];
  godsFeatureCache?: FeatureCache | false;
}
export interface GridComposite {
  props: Record<string, unknown>;
  state: CompositeState;
  context: { viewport?: Partial<GlobeViewportLike> };
  setState(update: object): void;
  _updatePositions(): void;
  _updateFeatures(): void;
}
type Method = (this: GridComposite) => void;

/** The props a point's sampled value depends on — any change empties the cache. */
const SAMPLING_PROPS = [
  "image",
  "image2",
  "imageSmoothing",
  "imageInterpolation",
  "imageWeight",
  "imageType",
  "imageUnscale",
  "imageMinValue",
  "imageMaxValue",
  "bounds",
] as const;
/** Order 7 has 163 842 points; past this the cache starts over rather than grow. */
const MAX_CACHED = 200_000;
const PATCHED = Symbol.for("gods.wlGridPatch");

class FeatureCache {
  private readonly signature: unknown[];
  private readonly byPoint = new Map<LngLat, GridFeature | null>();
  constructor(props: Record<string, unknown>) {
    this.signature = SAMPLING_PROPS.map((k) => props[k]);
  }
  matches(props: Record<string, unknown>): boolean {
    return SAMPLING_PROPS.every((k, i) => props[k] === this.signature[i]);
  }
  get size(): number {
    return this.byPoint.size;
  }
  has(p: LngLat): boolean {
    return this.byPoint.has(p);
  }
  get(p: LngLat): GridFeature | null | undefined {
    return this.byPoint.get(p);
  }
  set(p: LngLat, f: GridFeature | null): void {
    this.byPoint.set(p, f);
  }
}

const isGlobe = (v: Partial<GlobeViewportLike> | undefined): v is GlobeViewportLike =>
  !!v && !!v.resolution && typeof v.scale === "number" && typeof v.unproject === "function";

/** `_updatePositions` from the memoised builder on globe viewports. */
export function memoisedUpdatePositions(original: Method): Method {
  return function (this: GridComposite) {
    const viewport = this.context.viewport;
    if (!isGlobe(viewport)) return original.call(this);
    const density = typeof this.props.density === "number" ? this.props.density : 0;
    this.setState({ positions: globeGridPositions(viewport, density + 3) });
    this._updateFeatures();
  };
}

/** `_updateFeatures` sampling only the positions not yet in the layer's cache. */
export function cachedUpdateFeatures(original: Method): Method {
  return function (this: GridComposite) {
    const { positions } = this.state;
    if (!positions || !this.props.image || this.state.godsFeatureCache === false) return original.call(this);
    let cache = this.state.godsFeatureCache;
    if (!cache || !cache.matches(this.props) || cache.size > MAX_CACHED) {
      cache = new FeatureCache(this.props);
      this.state.godsFeatureCache = cache;
    }
    const missing = positions.filter((p) => !cache.has(p));
    if (missing.length) {
      this.state.positions = missing;
      try {
        original.call(this);
      } finally {
        this.state.positions = positions;
      }
      const fresh = this.state.points ?? [];
      const wanted = new Set<LngLat>(missing);
      if (!fresh.every((f) => wanted.has(f.geometry.coordinates))) {
        // Features don't sit on their positions in this WeatherLayers: no
        // cache, and the full set from the original from now on.
        this.state.godsFeatureCache = false;
        return original.call(this);
      }
      for (const f of fresh) cache.set(f.geometry.coordinates, f);
      for (const p of missing) if (!cache.has(p)) cache.set(p, null);
    }
    const points: GridFeature[] = [];
    for (const p of positions) {
      const f = cache.get(p);
      if (f) points.push(f);
    }
    this.setState({ points });
  };
}

const src = (fn: unknown): string => (typeof fn === "function" ? Function.prototype.toString.call(fn) : "");

/** Patch a GridCompositeLayer-shaped class in place (exported for tests). */
export function patchGridComposite(ctor: { prototype: object }): PatchResult {
  const proto = ctor.prototype as Record<string | symbol, unknown>;
  if (proto[PATCHED]) return "already";
  // The 2026.5 shapes: positions from the viewport at density + 3, then the
  // features; features from state.positions, NaN-filtered, into state.points.
  const up = src(proto._updatePositions);
  const uf = src(proto._updateFeatures);
  const shapeOk =
    /\+\s*3\)/.test(up) &&
    /_updateFeatures\(\)/.test(up) &&
    /positions/.test(up) &&
    /positions/.test(uf) &&
    /isNaN/.test(uf) &&
    /points/.test(uf);
  if (!shapeOk) return "skipped";
  Object.defineProperty(proto, "_updatePositions", { value: memoisedUpdatePositions(proto._updatePositions as Method), writable: true, configurable: true });
  Object.defineProperty(proto, "_updateFeatures", { value: cachedUpdateFeatures(proto._updateFeatures as Method), writable: true, configurable: true });
  Object.defineProperty(proto, PATCHED, { value: true });
  return "patched";
}

let compositeReported = false;
/** Wrap a GridLayer-shaped class's renderLayers to patch the composite it creates. */
export function patchGridLayer(ctor: { prototype: object }): PatchResult {
  const proto = ctor.prototype as Record<string | symbol, unknown>;
  if (proto[PATCHED]) return "already";
  const original = proto.renderLayers;
  if (!/composite/.test(src(original))) return "skipped";
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const out = (original as (...a: unknown[]) => unknown).apply(this, args);
    const first = Array.isArray(out) ? out[0] : out;
    if (first && typeof first === "object") {
      const result = patchGridComposite((first as { constructor: { prototype: object } }).constructor);
      if (result === "skipped" && !compositeReported) {
        compositeReported = true;
        console.info("[globe] WeatherLayers GridCompositeLayer shape changed — grid position/feature caches not applied");
      }
    }
    return out;
  };
  Object.defineProperty(proto, "renderLayers", { value: wrapped, writable: true, configurable: true });
  Object.defineProperty(proto, PATCHED, { value: true });
  return "patched";
}

/**
 * A/B switch for this patch, off the page URL: `?nogrid=1` on /watch leaves
 * WeatherLayers' own uncached grid in place.
 *
 * It exists because the operator reports barbs showing calm circles and single
 * half-barbs in places the field should be strong (a damaging-wind warning,
 * 2026-09-10) and the sampled values, not the glyph choice, are what look wrong
 * — the atlas units were checked and are correct. This cache is the one thing
 * standing between WeatherLayers' sampling and what gets drawn, so it is the
 * first thing to rule in or out. Flipping it needs no rebuild: change the OBS
 * browser source URL, reload, look. If the circles survive `?nogrid=1`, the
 * cause is upstream of us (WeatherLayers' sampling or the baked texture) and
 * this patch is exonerated.
 */
export function gridPatchDisabled(search: string | undefined, env?: string): boolean {
  // Env first: the OBS browser sources on the encoder host are created from the
  // stream config, not by hand, so the operator has no UI in which to edit a
  // URL — but the deploy syncs `.env.deploy`, which makes an env var the lever
  // they actually have. `NEXT_PUBLIC_WL_GRID_PATCH=off` disables the cache for
  // every source at once; set it back to anything else (or drop it) to restore.
  const e = env?.trim().toLowerCase();
  if (e === "off" || e === "0" || e === "false" || e === "no") return true;
  if (!search) return false;
  const v = new URLSearchParams(search).get("nogrid");
  return v !== null && v !== "0" && v !== "false";
}

/** Install on WeatherLayers' GridLayer. Logs when the shape is unknown. */
export function installGridPatch(): PatchResult {
  const search = typeof location !== "undefined" ? location.search : undefined;
  if (gridPatchDisabled(search, process.env.NEXT_PUBLIC_WL_GRID_PATCH)) {
    godsLog("[globe] WeatherLayers grid caches DISABLED (NEXT_PUBLIC_WL_GRID_PATCH / ?nogrid) — uncached sampling (A/B)");
    return "skipped";
  }
  const installed = patchGridLayer(GridLayer as unknown as { prototype: object });
  godsLog(
    installed === "skipped"
      ? "[globe] WeatherLayers GridLayer shape changed — grid caches not applied"
      : "[globe] WeatherLayers grid caches active",
  );
  return installed;
}
