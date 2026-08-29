import { GeoJsonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import type { AlertFeature } from "../../lib/alerts";
import { hazardMeta } from "../../lib/hazard";
import { alertFocusKey, litWeight, type AlertFocus } from "../../lib/alert-cycle";
import { DEPTH_TEST } from "./depth";

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
const repPoint = (f: AlertFeature): [number, number] | null => alertRepPoint(f.geometry);

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
  // Depth-tested so far-side areas are occluded by the basemap depth sphere
  // instead of bleeding through the front of the globe.
  const params = DEPTH_TEST;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [
    // 1 ─ Wide soft halo (outer bloom). Lines only, no fill, no point circles.
    new GeoJsonLayer({
      id: "alerts-glow-wide",
      data,
      filled: false,
      stroked: true,
      pointType: "circle",
      getPointRadius: 0,
      pointRadiusMaxPixels: 0,
      getLineColor: (f: any) => withA(lighten(base(f), 0.35), 26 * lit(f)),
      getLineWidth: (f: any) => 6 + rank(f) * 3,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: params,
      updateTriggers: { getLineColor: [n, focusKey], getLineWidth: n },
    }),
    // 2 ─ Mid glow.
    new GeoJsonLayer({
      id: "alerts-glow-mid",
      data,
      filled: false,
      stroked: true,
      pointType: "circle",
      getPointRadius: 0,
      pointRadiusMaxPixels: 0,
      getLineColor: (f: any) => withA(lighten(base(f), 0.2), 70 * lit(f)),
      getLineWidth: (f: any) => 3 + rank(f) * 1.4,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 2.5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: params,
      updateTriggers: { getLineColor: [n, focusKey], getLineWidth: n },
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
    new GeoJsonLayer({
      id: "alerts-edge",
      data,
      filled: false,
      stroked: true,
      pointType: "circle",
      getPointRadius: 0,
      pointRadiusMaxPixels: 0,
      // The outline now carries the shape (the fill was lightened so a
      // country-sized blob doesn't hide the weather under it), so it's a touch
      // wider — the boundary has to stay legible on a wide shot without the fill
      // helping.
      // The one pass a ghosted shape keeps: dimmed and hairline, so the warning
      // picture stays whole while only the cycle's current hazard glows.
      getLineColor: (f: any) =>
        withA(lighten(base(f), 0.55), GHOST_EDGE_ALPHA + (240 - GHOST_EDGE_ALPHA) * lit(f)),
      getLineWidth: (f: any) => {
        const full = 1.6 + rank(f) * 0.35;
        return GHOST_EDGE_WIDTH + (full - GHOST_EDGE_WIDTH) * lit(f);
      },
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 1,
      pickable: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: params,
      updateTriggers: { getLineColor: [n, focusKey], getLineWidth: [n, focusKey] },
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
        characterSet: "auto",
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
 * On-air highlight: while the director holds an alert, breathe *its own area*
 * (fill opacity + a widening lit edge) so the eye locks onto the shape being
 * talked about, not a free-floating reticle. Re-built every frame by the globe's
 * pulse loop, so `now` drives the phase. Only when the on-air event has no drawn
 * polygon (point-only / geometry stripped) do we fall back to a pulsing sonar
 * ring + hazard-coloured dot at the framing point — a real area never gets the
 * location marker, since its breathing outline already carries the highlight.
 */
export function onAirPulseLayers(
  features: AlertFeature[],
  at: [number, number],
  now: number,
  fallbackColor: [number, number, number] = [255, 95, 95],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  // `breathe` 0→1→0 (a soft heartbeat); `ping` 0→1 ramps then snaps back (an
  // expanding sonar ring). Both are derived from `now`, but EVERY animated prop
  // below is a *function* accessor keyed by `updateTriggers: { …: now }` — deck
  // only re-uploads accessor values when their trigger changes, and silently
  // ignores triggers on constant (non-function) accessors. Passing constants
  // here is exactly why the highlight rendered once and never moved.
  const phase = (now % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
  const breathe = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
  const ping = phase; // 0..1 sawtooth
  const onAir = onAirFeature(features, at);
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
  if (area) {
    layers.push(
      new GeoJsonLayer({
        id: "alerts-onair-fill",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: [onAir] as any,
        filled: true,
        stroked: true,
        getFillColor: () => withA(c, 40 + 110 * breathe),
        getLineColor: () => withA(lit, 220),
        getLineWidth: () => 1.5 + 4 * breathe,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 1.5,
        parameters: DEPTH_TEST,
        updateTriggers: { getFillColor: now, getLineColor: now, getLineWidth: now },
      }),
    );
    return layers;
  }

  // 2 ─ No drawable area → an expanding "sonar" ring at the framing point plus a
  //     breathing core dot, so a point-only alert still reads unmistakably on a
  //     wide broadcast shot.
  layers.push(
    new ScatterplotLayer<{ position: [number, number] }>({
      id: "alerts-onair-ping",
      data: [{ position: at }],
      getPosition: (d) => d.position,
      stroked: true,
      filled: false,
      radiusUnits: "pixels",
      // Bigger radial expansion — the ring sweeps out to ~90px so the "sonar"
      // read is unmistakable on a wide broadcast shot.
      getRadius: () => 14 + 76 * ping,
      radiusMinPixels: 6,
      getLineColor: () => [lit[0], lit[1], lit[2], Math.round(230 * (1 - ping))],
      getLineWidth: () => 2.5 + 2.5 * (1 - ping),
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 1.5,
      parameters: DEPTH_TEST,
      updateTriggers: { getRadius: now, getLineColor: now, getLineWidth: now },
    }),
    // 3 ─ A solid breathing core dot under the ring (anchors the ping; the sole
    //     highlight when the on-air event has no drawn polygon).
    new ScatterplotLayer<{ position: [number, number] }>({
      id: "alerts-onair-dot",
      data: [{ position: at }],
      getPosition: (d) => d.position,
      stroked: true,
      filled: true,
      radiusUnits: "pixels",
      getRadius: () => 6 + 4 * breathe,
      radiusMinPixels: 3,
      getFillColor: () => withA(c, 150 + 80 * breathe),
      getLineColor: [lit[0], lit[1], lit[2], 255],
      getLineWidth: 1.5,
      lineWidthUnits: "pixels",
      parameters: DEPTH_TEST,
      updateTriggers: { getRadius: now, getFillColor: now },
    }),
  );

  return layers;
}
