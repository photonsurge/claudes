import { GeoJsonLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from "@deck.gl/layers";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import type { AlertFeature } from "../../lib/alerts";
import { HAZARDS, hazardMeta } from "../../lib/hazard";

/**
 * Every code point the badge glyph layer can ever draw — the hazard catalog's
 * icons — fixed up front instead of `characterSet: "auto"`. "auto" re-derived
 * the set from the badges on every data change, and each cut that surfaced a
 * hazard not yet in the atlas extended the SDF atlas on the main thread
 * (measureText + glyph draw + distance transform, 100–200 ms in one frame —
 * docs/watch-perf-plan.md, round 53). Built once, the atlas is complete.
 */
export const HAZARD_GLYPHS: string[] = Array.from(new Set(HAZARDS.flatMap((h) => Array.from(h.icon))));
import { alertFocusKey, litWeight, type AlertFocus } from "../../lib/alert-cycle";
import { DEPTH_TEST } from "./depth";
import { BREATHE, type BreatheProps, type BreatheSpec } from "./breathe-extension";
import {
  NO_PARTS,
  NO_RINGS,
  outlineRings,
  polygonParts,
  type OutlineRing,
  type PolygonRings,
} from "./outline-rings";

/** "#rrggbb" → [r,g,b]. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lerp a colour toward white by t∈[0,1] — used to make glow edges read as "lit". */
function lighten(c: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(c[0] + (255 - c[0]) * t),
    Math.round(c[1] + (255 - c[1]) * t),
    Math.round(c[2] + (255 - c[2]) * t),
  ];
}

const rank = (f: AlertFeature): SeverityRank => f.properties.severityRank;

/**
 * Fill alpha, by severity: `FILL_BASE + rank * FILL_PER_RANK`.
 *
 * Deliberately light, because the fill is only ONE of four passes over the same
 * shape (wide halo, mid glow, fill, lit edge) and they stack. These were tuned
 * when an alert area meant a single county; once the worker started dissolving
 * touching areas, one shape became the whole of France, and at the old
 * 45 + rank*16 (36% for an amber warning) a country-sized blob stopped reading as
 * a warning over a temperature map and became a grey slab that hid the map.
 *
 * The outline carries the shape — it's crisp, lit and severity-scaled — so the
 * fill only has to say "inside", not "opaque". Keep it under ~25% at rank 4.
 */
const FILL_BASE = 22;
const FILL_PER_RANK = 10;

/** One full breath of the on-air pulse, in ms. */
const PULSE_PERIOD_MS = 1500;

/**
 * What a shape that ISN'T the currently-lit hazard keeps (see lib/alert-cycle):
 * a thin, dim outline and nothing else. The bloom passes and the fill are what
 * stack into mush when four hazards overlap the same ground, so those go to zero
 * — but the boundary stays, so the viewer keeps the whole warning picture and
 * only the current type glows.
 */
const GHOST_EDGE_ALPHA = 38;
const GHOST_EDGE_WIDTH = 1;

/**
 * Area hue comes from the hazard *type* (flood = blue, fire = red…), matching
 * the badge dot and the on-screen legend, so a viewer reads *what* a warning is
 * from its colour. Severity is kept for intensity (glow width + fill opacity),
 * not hue.
 */
const base = (f: AlertFeature): [number, number, number] => rgb(hazardMeta(f.properties.hazard).color);

const withA = (c: [number, number, number], a: number): [number, number, number, number] => [
  c[0],
  c[1],
  c[2],
  a,
];

/**
 * Where the hazard badge sits — shared with the director's camera framing so the
 * on-air pulse reticle lands on the same point as the badge (see alertRepPoint).
 */
const repPoints = new WeakMap<AlertFeature, [number, number] | null>();
const repPoint = (f: AlertFeature): [number, number] | null => {
  // Memoised per feature: onAirFeature scans every drawn alert for the nearest
  // rep point on each rebuild, and a rep point is a geometry walk (~0.5 s of a
  // minute's main thread on the profiler, round 25).
  let p = repPoints.get(f);
  if (p === undefined) {
    p = alertRepPoint(f.geometry);
    repPoints.set(f, p);
  }
  return p;
};

/**
 * True when the feature draws a real polygon (Polygon/MultiPolygon). Polygon
 * alerts already read their location + hazard colour from the glowing area, so
 * the hazard badge is only added for point-only alerts (Point geometry / no
 * drawable area), where there's otherwise nothing on the globe to see.
 */
const hasArea = (f: AlertFeature): boolean =>
  f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon";

interface Badge {
  pos: [number, number];
  rank: SeverityRank;
  color: [number, number, number];
  icon: string;
  /** 0 (ghosted by the hazard cycle) → 1 (lit). */
  lit: number;
}

/**
 * Weather-alert overlay, tuned to "shine out" on a broadcast globe. Each alert
 * area is drawn in several passes — a wide soft halo, a brighter mid glow, a
 * translucent fill and a crisp lit edge — so severe warnings glow against the
 * weather raster instead of blending into it. On top of every area (and each
 * point-source hazard) sits a hazard badge: a glowing dot tinted by hazard type
 * with the hazard glyph, so an operator reads *what* the warning is at a glance.
 * Severity (0 info … 4 extreme) scales the glow, the fill opacity and the badge.
 *
 * `focus` (optional) is the hazard cycle: when set, only the hazard type it names
 * is drawn in full, and every other type drops to a ghost outline. See
 * lib/alert-cycle for why, and `litWeight` for the cross-fade.
 */
export function alertsLayer(features: AlertFeature[], visible = true, focus: AlertFocus | null = null) {
  const n = features.length;
  // Every accessor below is keyed on this alongside `n`, so a step change
  // re-uploads colours only. The `data` array reference is deliberately left
  // alone (see below) — splitting it per hazard would re-tessellate thousands of
  // polygons every few seconds.
  const focusKey = alertFocusKey(focus);
  const lit = (f: AlertFeature): number => litWeight(focus, f.properties.hazard);

  // Badge anchor + hazard styling, computed once per feature.
  const badges: Badge[] = [];
  for (const f of features) {
    // Polygon alerts read as their glowing area; only point-only alerts get a
    // badge, so the badge is a marker for "nothing else to see here", not extra
    // clutter sitting on top of every drawn shape.
    if (hasArea(f)) continue;
    const pos = repPoint(f);
    if (!pos) continue;
    const meta = hazardMeta(f.properties.hazard);
    badges.push({ pos, rank: rank(f), color: rgb(meta.color), icon: meta.icon, lit: lit(f) });
  }

  // Shared GeoJSON config — passed array reference is stable between polls, so
  // deck doesn't re-tessellate on every globe rebuild (dead-reckon ticks).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = features as any;
  // The three stroke passes are PathLayers over the polygon rings (memoised on
  // `features` identity), not stroke-only GeoJsonLayers: GeoJsonLayer always
  // adds a polygons-fill sublayer that earcuts every polygon even with
  // `filled: false`, so the old stack tessellated thousands of alert shapes
  // FOUR times per refresh. Only `alerts-fill` still needs (one) tessellation.
  const rings = outlineRings(features);
  type Ring = OutlineRing<AlertFeature>;
  // Depth-tested so far-side areas are occluded by the basemap depth sphere
  // instead of bleeding through the front of the globe.
  const params = DEPTH_TEST;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [
    // 1 ─ Wide soft halo (outer bloom). Lines only, no fill, no point circles.
    new PathLayer<Ring>({
      id: "alerts-glow-wide",
      data: rings,
      getPath: (d) => d.path as [number, number][],
      getColor: (d) => withA(lighten(base(d.feature), 0.35), 26 * lit(d.feature)),
      getWidth: (d) => 6 + rank(d.feature) * 3,
      widthUnits: "pixels",
      widthMinPixels: 5,
      parameters: params,
      updateTriggers: { getColor: [n, focusKey], getWidth: n },
    }),
    // 2 ─ Mid glow.
    new PathLayer<Ring>({
      id: "alerts-glow-mid",
      data: rings,
      getPath: (d) => d.path as [number, number][],
      getColor: (d) => withA(lighten(base(d.feature), 0.2), 70 * lit(d.feature)),
      getWidth: (d) => 3 + rank(d.feature) * 1.4,
      widthUnits: "pixels",
      widthMinPixels: 2.5,
      parameters: params,
      updateTriggers: { getColor: [n, focusKey], getWidth: n },
    }),
    // 3 ─ Translucent fill (opacity climbs with severity).
    new GeoJsonLayer({
      id: "alerts-fill",
      data,
      filled: true,
      stroked: false,
      pointType: "circle",
      getPointRadius: 0,
      pointRadiusMaxPixels: 0,
      getFillColor: (f: any) => withA(base(f), (FILL_BASE + rank(f) * FILL_PER_RANK) * lit(f)),
      // Pickable so click-to-select works anywhere inside the alert area, not
      // just on the ~1px edge stroke (which is the only other pickable layer).
      pickable: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: params,
      updateTriggers: { getFillColor: [n, focusKey] },
    }),
    // 4 ─ Crisp lit edge on top.
    new PathLayer<Ring>({
      id: "alerts-edge",
      data: rings,
      getPath: (d) => d.path as [number, number][],
      // The outline now carries the shape (the fill was lightened so a
      // country-sized blob doesn't hide the weather under it), so it's a touch
      // wider — the boundary has to stay legible on a wide shot without the fill
      // helping.
      // The one pass a ghosted shape keeps: dimmed and hairline, so the warning
      // picture stays whole while only the cycle's current hazard glows.
      getColor: (d) =>
        withA(lighten(base(d.feature), 0.55), GHOST_EDGE_ALPHA + (240 - GHOST_EDGE_ALPHA) * lit(d.feature)),
      getWidth: (d) => {
        const full = 1.6 + rank(d.feature) * 0.35;
        return GHOST_EDGE_WIDTH + (full - GHOST_EDGE_WIDTH) * lit(d.feature);
      },
      widthUnits: "pixels",
      widthMinPixels: 1,
      // A pick here yields the ring datum; Globe unwraps it with pickedFeature().
      pickable: true,
      parameters: params,
      updateTriggers: { getColor: [n, focusKey], getWidth: [n, focusKey] },
    }),
  ];

  if (badges.length) {
    // Badge radius (px), core grows with severity.
    const coreR = (b: Badge) => 6 + b.rank * 1.6;
    // A ghosted point-only alert has no outline to fall back on, so it fades out
    // entirely rather than leaving a dot competing with the lit hazard.
    const badgeKey = [badges.length, focusKey];

    layers.push(
      // 5 ─ Badge halo — the "shine" behind the hazard dot.
      new ScatterplotLayer<Badge>({
        id: "alerts-badge-halo",
        data: badges,
        getPosition: (b) => [b.pos[0], b.pos[1], 0],
        getRadius: (b) => coreR(b) * 2.6,
        getFillColor: (b) => withA(lighten(b.color, 0.25), (38 + b.rank * 8) * b.lit),
        radiusUnits: "pixels",
        radiusMaxPixels: 60,
        stroked: false,
        pickable: false,
        parameters: DEPTH_TEST,
        updateTriggers: { getFillColor: badgeKey, getRadius: badges.length },
      }),
      // 6 ─ Badge core — hazard-tinted dot with a bright rim.
      new ScatterplotLayer<Badge>({
        id: "alerts-badge-core",
        data: badges,
        getPosition: (b) => [b.pos[0], b.pos[1], 0],
        getRadius: (b) => coreR(b),
        getFillColor: (b) => withA(b.color, 235 * b.lit),
        getLineColor: (b) =>
          [...lighten(b.color, 0.7), 255 * b.lit] as [number, number, number, number],
        getLineWidth: 1.4,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 1,
        radiusUnits: "pixels",
        radiusMinPixels: 4,
        radiusMaxPixels: 22,
        stroked: true,
        pickable: false,
        parameters: DEPTH_TEST,
        updateTriggers: {
          getFillColor: badgeKey,
          getLineColor: badgeKey,
          getRadius: badges.length,
        },
      }),
      // 7 ─ Hazard glyph on top (SDF text renders on the GlobeView; a blank
      //     glyph degrades gracefully to the colour-coded badge below it).
      new TextLayer<Badge>({
        id: "alerts-badge-glyph",
        data: badges,
        getPosition: (b) => [b.pos[0], b.pos[1], 0],
        getText: (b) => b.icon,
        getColor: (b) => [255, 255, 255, 255 * b.lit],
        getSize: (b) => 11 + b.rank * 1.5,
        sizeUnits: "pixels",
        sizeMinPixels: 10,
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        fontFamily: "system-ui, sans-serif",
        fontSettings: { sdf: true },
        outlineWidth: 2,
        outlineColor: [0, 0, 0, 180],
        characterSet: HAZARD_GLYPHS,
        pickable: false,
        parameters: DEPTH_TEST,
        updateTriggers: { getText: badges.length, getSize: badges.length, getColor: badgeKey },
      }),
    );
  }

  // Toggle visibility rather than add/remove the layers: a hidden deck layer
  // keeps its tessellated geometry, so flipping `state.showAlerts` (e.g. on every
  // director cut) is instant instead of re-tessellating thousands of polygons.
  return layers.map((l) => l.clone({ visible }));
}

/** ~0.5° tolerance² for matching the on-air centroid to a drawn alert area. */
const ON_AIR_EPS2 = 0.25;

/** The drawn alert area nearest the director's on-air centroid, or null. */
function onAirFeature(features: AlertFeature[], at: [number, number]): AlertFeature | null {
  let best: AlertFeature | null = null;
  let bestD = Infinity;
  for (const f of features) {
    const p = repPoint(f);
    if (!p) continue;
    const d = (p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return bestD <= ON_AIR_EPS2 ? best : null;
}

/**
 * Stable `data` arrays for the pulse layers. deck treats a new `data` reference
 * as "re-tessellate / re-upload everything", and the on-air breathe is rebuilt
 * every frame — so a fresh `[onAir]` literal per frame put the dissolved,
 * country-sized alert polygon through earcut 60 times a second.
 */
const areaDataCache = new WeakMap<AlertFeature, AlertFeature[]>();
function areaData(f: AlertFeature): AlertFeature[] {
  let d = areaDataCache.get(f);
  if (!d) {
    d = [f];
    areaDataCache.set(f, d);
  }
  return d;
}
type PulsePoint = { position: [number, number] };
let pointDataCache: { at: [number, number]; data: PulsePoint[] } | null = null;
function pointData(at: [number, number]): PulsePoint[] {
  const c = pointDataCache;
  if (c && c.at[0] === at[0] && c.at[1] === at[1]) return c.data;
  const data: PulsePoint[] = [{ position: [at[0], at[1]] }];
  pointDataCache = { at: [at[0], at[1]], data };
  return data;
}

/**
 * Does the on-air highlight at `at` fall back to the POINT ping (sonar ring +
 * dot)? That branch still animates through per-commit uniforms, so Globe's
 * pulse loop only re-commits while this is true; an on-air AREA breathes on
 * the GPU (BreatheExtension) from static layers and needs no loop.
 */
export function pulseIsPoint(features: AlertFeature[], at: [number, number]): boolean {
  const onAir = onAirFeature(features, at);
  return !(onAir && hasArea(onAir));
}

/**
 * On-air highlight: while the director holds an alert, breathe *its own area*
 * (fill opacity + a widening lit edge) so the eye locks onto the shape being
 * talked about, not a free-floating reticle. Rebuilt every frame by the globe's
 * pulse loop, so EVERYTHING animated here rides a layer-level GPU uniform
 * (`opacity`, `lineWidthScale`, `radiusScale`) over CONSTANT attributes and
 * stable `data`: a frame costs a few uniform writes, never an attribute
 * regeneration or a re-tessellation. (The previous version keyed function
 * accessors on `now`, which regenerated every attribute of the whole polygon
 * each frame — and passed a fresh `[onAir]` array, which re-tessellated it.)
 *
 * `at: null` = nothing on air: returns just the AREA pair, empty and hidden.
 * The pair is always in the stack so deck keeps its models — and luma the
 * SolidPolygon+Breathe / Path+Breathe pipelines — between cuts; a polygon cut
 * then costs one tessellation of that shape, not a shader link as well.
 */
export function onAirPulseLayers(
  features: AlertFeature[],
  at: [number, number] | null,
  now: number,
  fallbackColor: [number, number, number] = [255, 95, 95],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  // `breathe` 0→1→0 (a soft heartbeat); `ping` 0→1 ramps then snaps back (an
  // expanding sonar ring).
  const phase = (now % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
  const breathe = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
  const ping = phase; // 0..1 sawtooth
  const onAir = at ? onAirFeature(features, at) : null;
  const c: [number, number, number] = onAir ? base(onAir) : fallbackColor;
  const lit: [number, number, number] = lighten(c, 0.6);

  // When the on-air event has a real drawn area (Polygon/MultiPolygon), the
  // breathing outline below IS the highlight — the eye locks onto the shape, so
  // we deliberately suppress the location ping/dot marker. The marker is a
  // "here, since there's nothing else to see" fallback for point-only alerts,
  // mirroring how the static badge is only drawn where there's no area.
  const area = onAir ? hasArea(onAir) : false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [];

  // 1 ─ Breathe the on-air area itself, so the eye locks onto the exact shape.
  //     These two layers are STATIC: BreatheExtension breathes them on the GPU
  //     (alpha / width multipliers from a clock uniform), so no pulse-loop
  //     commit is needed while an area is on air — see pulseIsPoint().
  //     They are ALWAYS committed (empty + hidden without an area) so their
  //     shader pipelines stay warm — see the function doc. Direct
  //     SolidPolygonLayer / PathLayer, not GeoJsonLayer: an empty GeoJsonLayer
  //     builds no sublayers (nothing to keep warm), and its stroke-only pass
  //     would earcut the dissolved shape a second time (see outline-rings.ts).
  const onAirArea = area && onAir ? onAir : null;
  const fillParts = onAirArea ? polygonParts(onAirArea) : NO_PARTS;
  const edgeRings = onAirArea ? outlineRings(areaData(onAirArea)) : NO_RINGS;
  // Fill alpha is baked at the breath's peak (150); the extension takes it
  // down to the trough (40) and back.
  const FILL_PEAK = 150;
  layers.push(
    new SolidPolygonLayer<PolygonRings, BreatheProps>({
      id: "alerts-onair-fill",
      data: fillParts,
      visible: !!onAirArea,
      getPolygon: (d) => d as [number, number][][],
      filled: true,
      getFillColor: withA(c, FILL_PEAK),
      extensions: [BREATHE],
      breathe: { periodMs: PULSE_PERIOD_MS, alpha: [40 / FILL_PEAK, 1] } satisfies BreatheSpec,
      parameters: DEPTH_TEST,
    }),
    // Lit edge: a constant 1.5 px width attribute, swelled to 5.5 px at the peak.
    new PathLayer<OutlineRing<AlertFeature>, BreatheProps>({
      id: "alerts-onair-edge",
      data: edgeRings,
      visible: !!onAirArea,
      getPath: (d) => d.path as [number, number][],
      getColor: withA(lit, 220),
      getWidth: 1.5,
      widthUnits: "pixels",
      widthMinPixels: 1.5,
      extensions: [BREATHE],
      breathe: { periodMs: PULSE_PERIOD_MS, size: [1, 5.5 / 1.5] } satisfies BreatheSpec,
      parameters: DEPTH_TEST,
    }),
  );
  if (onAirArea || at === null) return layers;

  // 2 ─ No drawable area → an expanding "sonar" ring at the framing point plus a
  //     breathing core dot, so a point-only alert still reads unmistakably on a
  //     wide broadcast shot.
  const data = pointData(at);
  layers.push(
    new ScatterplotLayer<PulsePoint>({
      id: "alerts-onair-ping",
      data,
      getPosition: (d) => d.position,
      stroked: true,
      filled: false,
      radiusUnits: "pixels",
      // Bigger radial expansion — the ring sweeps out to ~90px so the "sonar"
      // read is unmistakable on a wide broadcast shot. Unit radius attribute,
      // `radiusScale` is the animated pixel radius.
      getRadius: 1,
      radiusScale: 14 + 76 * ping,
      radiusMinPixels: 6,
      getLineColor: [lit[0], lit[1], lit[2], 230],
      opacity: 1 - ping,
      getLineWidth: 2.5,
      lineWidthScale: (2.5 + 2.5 * (1 - ping)) / 2.5,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 1.5,
      parameters: DEPTH_TEST,
    }),
    // 3 ─ A solid breathing core dot under the ring (anchors the ping; the sole
    //     highlight when the on-air event has no drawn polygon).
    new ScatterplotLayer<PulsePoint>({
      id: "alerts-onair-dot",
      data,
      getPosition: (d) => d.position,
      stroked: true,
      filled: true,
      radiusUnits: "pixels",
      getRadius: 6,
      radiusScale: (6 + 4 * breathe) / 6,
      radiusMinPixels: 3,
      getFillColor: withA(c, 230),
      getLineColor: [lit[0], lit[1], lit[2], 255],
      getLineWidth: 1.5,
      lineWidthUnits: "pixels",
      opacity: (150 + 80 * breathe) / 230,
      parameters: DEPTH_TEST,
    }),
  );

  return layers;
}
