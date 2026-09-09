import { GeoJsonLayer, PathLayer } from "@deck.gl/layers";
import { DEPTH_TEST } from "./depth";
import { BREATHE, type BreatheProps, type BreatheSpec } from "./breathe-extension";
import { outlineRings, type OutlineRing } from "./outline-rings";
// countries.geojson is fetched + parsed once per page and shared with the
// basemap borders layer — see country-features.ts.
import { loadCountryFeatures, type CountryFeature } from "./country-features";

/** Resolve a spotlighted country's ISO-3166 alpha-2 to its boundary feature, or
 *  null while loading / on a miss. Callers poll this each render (cheap: the
 *  underlying fetch+parse only ever happens once). */
export async function countryFeatureFor(iso2: string): Promise<CountryFeature | null> {
  const byIso = await loadCountryFeatures();
  return byIso.get(iso2.toUpperCase()) ?? null;
}

function ringBbox(ring: number[][]): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

/** Every ring's own bbox — Polygon: one outer ring; MultiPolygon: one per part
 *  — so a country whose parts straddle the antimeridian (Russia, Fiji) is
 *  tested piece-by-piece instead of collapsing to one bogus globe-spanning
 *  box that would falsely overlap almost any framed region. */
function partBboxes(geometry: { type?: string; coordinates?: unknown } | null): [number, number, number, number][] {
  if (geometry?.type === "Polygon") return [ringBbox((geometry.coordinates as number[][][])[0])];
  if (geometry?.type === "MultiPolygon")
    return (geometry.coordinates as number[][][][]).map((poly) => ringBbox(poly[0]));
  return [];
}

function bboxesOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** Every country whose boundary overlaps a framed [west,south,east,north] box
 *  — used to glow all the countries inside a wide framed shot, rather than a
 *  single spotlighted one. Bbox-vs-bbox only (not true polygon
 *  intersection): an approximation, same spirit as bboxForCamera's own
 *  "heuristic, not a projection" — fine for a broadcast highlight. */
export async function countriesInBbox(bbox: [number, number, number, number]): Promise<CountryFeature[]> {
  const byIso = await loadCountryFeatures();
  return [...byIso.values()].filter((feature) =>
    partBboxes(feature.geometry).some((partBox) => bboxesOverlap(partBox, bbox)),
  );
}

/** One full breath of the glow, in ms. */
const GLOW_PERIOD_MS = 2600;

/** ms each flag colour holds before blending into the next in the cycle. */
const FLAG_DWELL_MS = 1400;

/** Smoothly cycle a palette over time — blends adjacent colours so the glow
 *  drifts through a country's flag colours rather than hard-cutting. One colour
 *  → constant; empty → white. Pure/testable. */
export function cyclePalette(
  pal: [number, number, number][],
  now: number,
  dwellMs = FLAG_DWELL_MS,
): [number, number, number] {
  const n = pal.length;
  if (n === 0) return [255, 255, 255];
  if (n === 1) return pal[0];
  const t = (((now / dwellMs) % n) + n) % n; // continuous 0..n, negative-safe
  const i = Math.floor(t);
  const f = t - i;
  const a = pal[i % n];
  const b = pal[(i + 1) % n];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

function lighten(c: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(c[0] + (255 - c[0]) * t),
    Math.round(c[1] + (255 - c[1]) * t),
    Math.round(c[2] + (255 - c[2]) * t),
  ];
}
const withA = (c: [number, number, number], a: number): [number, number, number, number] => [c[0], c[1], c[2], a];

/** Same teal family as KIND_COLOR.country (components/broadcast/kinds.ts) but
 *  brighter/more saturated — that muted tone reads fine as a small UI badge,
 *  but a globe-spanning glow needs more punch to actually shine against the
 *  weather raster from a wide shot. */
const GLOW_COLOR: [number, number, number] = [70, 225, 225];

/** ms between re-evaluations of the flag-colour cycle. The colour accessors
 *  below regenerate a per-vertex attribute over EVERY boundary vertex when
 *  their trigger moves, so the drift is quantised to this beat instead of
 *  running per frame. Sub-second, so the blend still reads as continuous. */
const FLAG_COLOR_STEP_MS = 200;

/**
 * A breathing multi-pass halo around one or more spotlighted countries'
 * boundaries — wide soft glow, mid glow, translucent fill, crisp lit edge —
 * reusing the same layering technique alertsLayer/onAirPulseLayers use to make
 * an on-air weather area "shine out" against the basemap, so a country
 * spotlight (a single feature) or a wide framed shot (every country in view) reads
 * as visually distinct on the globe instead of relying on the camera move
 * alone. Returns [] while nothing has resolved yet (still loading, or no
 * geojson match).
 *
 * The breathe rides the GPU: colour/width attributes are baked at the breath's
 * PEAK and BreatheExtension multiplies alpha / width down to the trough and
 * back from a clock uniform each draw, so the layers are STATIC — Globe commits
 * them once per spotlight, not per frame (an earlier version rebuilt them at
 * 15 Hz with `opacity` / `lineWidthScale`, and each commit re-diffed the whole
 * stack; before that, `updateTriggers: now` regenerated every attribute of a
 * 4 MB country outline, ×3 passes, every frame). Only the flag-colour drift
 * (`paletteFor`) still needs a rebuild, on its 200 ms step.
 *
 * `opts.fill: false` drops the translucent interior fill, so the glow is just
 * the framing halo + rim. `opts.color` overrides the base glow hue.
 * `opts.paletteFor` colours each feature by its flag palette (resolved from
 * `feature.properties.iso_a2`), cycling through the flag's colours over time;
 * features with no palette fall back to `opts.color`.
 */
export function countryGlowLayers(
  features: CountryFeature[],
  now: number,
  opts?: {
    fill?: boolean;
    color?: [number, number, number];
    paletteFor?: (iso2: string) => [number, number, number][] | null | undefined;
  },
): unknown[] {
  const color = opts?.color ?? GLOW_COLOR;
  const withFill = opts?.fill !== false;
  const paletteFor = opts?.paletteFor;
  // Per-feature glow hue: a country's cycling flag colours (quantised to
  // FLAG_COLOR_STEP_MS), else the flat base.
  const colorTick = paletteFor ? Math.floor(now / FLAG_COLOR_STEP_MS) : 0;
  const colorNow = colorTick * FLAG_COLOR_STEP_MS;
  const colorOf = (feature: CountryFeature): [number, number, number] => {
    if (paletteFor) {
      const iso = String(feature?.properties?.iso_a2 ?? "").toUpperCase();
      const pal = paletteFor(iso);
      if (pal && pal.length) return cyclePalette(pal, colorNow);
    }
    return color;
  };
  // The only thing that may regenerate the colour attribute: the base hue or
  // the (quantised) flag-cycle step.
  const colorKey = `${color.join(",")}|${colorTick}`;
  const data = features;
  // The boundary rings, memoised on `features` identity (see outline-rings.ts).
  const rings = outlineRings(features);
  // The layers are ALWAYS returned — empty and hidden when nothing is on air.
  // deck then keeps their models alive between spotlights, so luma keeps the
  // PathLayer+Breathe pipeline: a cut no longer re-links shaders (~0.5 s of
  // native time on the profiler) on top of building the new outline.
  const visible = rings.length > 0;

  /** One stroke pass: alpha/width baked at the peak, breathed on the GPU by
   *  BreatheExtension (alpha and width multipliers from a clock uniform) — the
   *  layer itself is static, so no per-frame commit is needed.
   *
   *  A PathLayer over the rings, NOT a stroke-only GeoJsonLayer: GeoJsonLayer
   *  always adds a polygons-fill sublayer that earcuts the whole outline even
   *  with `filled: false` — four rings over a 4 MB country outline was the
   *  822 ms main-thread stall at every spotlight cut. The stroke geometry is
   *  identical (GeoJsonLayer strokes polygons with exactly this PathLayer). */
  const stroke = (
    id: string,
    lightenBy: number,
    alpha: [number, number],
    width: [number, number],
    minPixels: number,
  ) => {
    const breathe: BreatheSpec = {
      periodMs: GLOW_PERIOD_MS,
      alpha: [alpha[0] / alpha[1], 1],
      size: [1, width[1] / width[0]],
    };
    return new PathLayer<OutlineRing<CountryFeature>, BreatheProps>({
      id,
      data: rings,
      visible,
      getPath: (d) => d.path as [number, number][],
      getColor: (d) => withA(lighten(colorOf(d.feature), lightenBy), alpha[1]),
      getWidth: width[0],
      widthUnits: "pixels",
      widthMinPixels: minPixels,
      extensions: [BREATHE],
      breathe,
      parameters: DEPTH_TEST,
      updateTriggers: { getColor: colorKey },
    });
  };

  return [
    // 1 ─ Outer bloom — very wide, low-opacity, so it reads from a whole-globe shot.
    stroke("country-glow-bloom", 0.4, [30, 52], [26, 40], 20),
    // 2 ─ Wide soft halo.
    stroke("country-glow-wide", 0.35, [70, 120], [14, 22], 11),
    // 3 ─ Mid glow.
    stroke("country-glow-mid", 0.2, [140, 230], [7, 11], 5),
    // 4 ─ Translucent fill so the whole country reads as lit, not just its edge.
    //     Omitted when a real map-imagery fill (countryMapGlow) sits underneath.
    ...(withFill
      ? [
          new GeoJsonLayer({
            id: "country-glow-fill",
            data,
            visible,
            filled: true,
            stroked: false,
            getFillColor: (f: CountryFeature) => withA(colorOf(f), 60),
            extensions: [BREATHE],
            breathe: { periodMs: GLOW_PERIOD_MS, alpha: [26 / 60, 1] } satisfies BreatheSpec,
            parameters: DEPTH_TEST,
            updateTriggers: { getFillColor: colorKey },
          }),
        ]
      : []),
    // 5 ─ Crisp lit edge on top, near-solid at the breath's peak.
    stroke("country-glow-edge", 0.6, [220, 255], [2.5, 5], 2),
  ];
}
