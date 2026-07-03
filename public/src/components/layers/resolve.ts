/**
 * PURE regional-nest resolver. Given a variable's manifest entry and the current
 * camera, it returns the ordered list of entries to render: the global base
 * first, then every ACTIVE regional nest (coarsest→finest, so the finest draws
 * last, on top). A nest is active when the camera has zoomed in far enough
 * (`zoom ≥ minZoom`) AND the view centre sits inside the nest's `bbox`.
 *
 * No GL and no deck here — the GL builders (index.ts) map each returned entry
 * through the matching prop builder with `entry === base ? full-globe : bbox`
 * bounds. Keeping selection pure makes it exhaustively unit-testable.
 */
import type { WeatherVariableManifest } from "@photonsurge/shared/manifest";

/** [lng, lat] centre + zoom — the subset of the control camera the resolver reads. */
export interface ResolverCamera {
  center: [number, number];
  zoom: number;
}

/** Global base resolution used as the reference for the derived nest zoom floor. */
const BASE_RES_DEG = 0.25;

/**
 * Default zoom floor for a nest lacking an explicit `minZoom`, derived from its
 * resolution: each halving of cell size below the 0.25° base earns ~+1 zoom
 * before the nest's extra pixels are worth showing. Clamped to a sane 2..6.
 */
export function defaultMinZoom(resolutionDeg: number): number {
  const steps = Math.log2(BASE_RES_DEG / Math.max(resolutionDeg, 1e-6));
  return Math.max(2, Math.min(6, 2 + steps));
}

/**
 * How much to lower every nest's zoom floor so regional detail becomes ELIGIBLE
 * earlier as you zoom. Safe because the winner is separately gated on actually
 * covering the view (see `viewCentralBbox` + the best-fit picker) — an eligible
 * nest that doesn't cover what you're looking at simply doesn't win.
 */
const MIN_ZOOM_LOWER = 1;

/** The zoom floor for a nest: explicit `minZoom`, else derived from resolution. */
export function nestMinZoom(nest: WeatherVariableManifest): number {
  const base =
    typeof nest.minZoom === "number"
      ? nest.minZoom
      : typeof nest.resolutionDeg === "number"
        ? defaultMinZoom(nest.resolutionDeg)
        : 3;
  return Math.max(2.5, base - MIN_ZOOM_LOWER);
}

/**
 * The central slice of the current viewport, as a bbox, used to decide whether a
 * nest actually COVERS what you're looking at (not just its centre point). The
 * globe frames a span of `360 / 2^(zoom-1.9)` degrees (inverse of `zoomForBbox`);
 * we take the central `frac` of that around the camera centre. A nest whose bbox
 * fully contains this box wins. A SMALLER `frac` lets a nest qualify while more
 * zoomed OUT (it only has to cover the very middle of the view), so regional maps
 * appear earlier and sit as an overlay on the base — at the cost of the nest's
 * edges being visible in-frame rather than off-screen.
 */
export function viewCentralBbox(
  camera: ResolverCamera,
  frac = 0.22,
): [number, number, number, number] {
  const half = 180 / Math.pow(2, camera.zoom - 1.9);
  const r = Math.max(0.01, half * frac);
  const [lng, lat] = camera.center;
  return [lng - r, Math.max(-90, lat - r), lng + r, Math.min(90, lat + r)];
}

/** Does `outer` fully contain `inner` (both [w,s,e,n])? No antimeridian wrap (v1). */
export function bboxContainsBbox(
  outer: [number, number, number, number],
  inner: [number, number, number, number],
): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

/**
 * BEST-FIT ranking of a variable's nests for the current camera: the nests whose bbox
 * COVERS the central view (`viewCentralBbox`), ordered FINEST-resolution first (ties →
 * higher priority). This is the pure decision behind single-winner rendering — the GL
 * builder walks this list and draws the first nest whose texture is loaded. Picking by
 * coverage-then-resolution (not manifest priority order) is why the UK gets ukv/dmi (a
 * fine nest spanning all of Britain) instead of arome-france, whose north edge cuts the
 * landmass and would leave a seam. A nest that only covers PART of the view is excluded,
 * so no winner ever cuts through the middle of the scene. `entries[0]` (the base) is
 * skipped; an empty result means "draw base only".
 */
export function rankNestsByFit(
  entries: WeatherVariableManifest[],
  camera: ResolverCamera,
): WeatherVariableManifest[] {
  const target = viewCentralBbox(camera);
  return entries
    .slice(1)
    .filter((e) => !!e.bbox && bboxContainsBbox(e.bbox, target))
    .sort((a, b) => {
      const ra = a.resolutionDeg ?? 1;
      const rb = b.resolutionDeg ?? 1;
      if (ra !== rb) return ra - rb; // finer (smaller degrees/cell) first
      return (b.priority ?? 0) - (a.priority ?? 0); // tie → higher priority first
    });
}

/**
 * Is [lng,lat] inside [west,south,east,north]? v1 does NOT wrap the antimeridian
 * (the regional nests — CONUS, Europe, ocean windows — never straddle ±180°).
 */
export function bboxContains(
  bbox: [number, number, number, number],
  lng: number,
  lat: number,
): boolean {
  const [w, s, e, n] = bbox;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

/** A nest renders when the view has zoomed in AND is centred inside its bbox. */
export function nestActive(nest: WeatherVariableManifest, camera: ResolverCamera): boolean {
  if (!nest.bbox) return false;
  return camera.zoom >= nestMinZoom(nest) && bboxContains(nest.bbox, camera.center[0], camera.center[1]);
}

/**
 * Ordered entries to render for a variable: `[base, ...activeNests]`. The base is
 * the entry itself (drawn full-globe); active nests follow in the entry's stored
 * coarsest→finest order. A base with empty `files` (nest-only variable, e.g.
 * radar) still appears here but yields no layer downstream — only its nests do.
 */
export function resolveEntries(
  entry: WeatherVariableManifest | undefined,
  camera: ResolverCamera,
): WeatherVariableManifest[] {
  if (!entry) return [];
  const out: WeatherVariableManifest[] = [entry];
  for (const nest of entry.nests ?? []) {
    if (nestActive(nest, camera)) out.push(nest);
  }
  return out;
}

/**
 * Stable signature of the ACTIVE nest set for a variable at this camera. The
 * Globe keys its layer-rebuild/preload effects on this so they re-run only when
 * the active-nest set flips (a zoom threshold crossed or the centre entering/
 * leaving a bbox), NOT on every camera tick.
 */
export function activeNestSignature(
  entry: WeatherVariableManifest | undefined,
  camera: ResolverCamera,
): string {
  const nests = entry?.nests;
  if (!nests?.length) return "";
  return nests
    .filter((n) => nestActive(n, camera))
    .map((n) => n.sourceId ?? (n.bbox ? n.bbox.join(",") : "?"))
    .join("|");
}
