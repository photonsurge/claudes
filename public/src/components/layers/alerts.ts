import { GeoJsonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import type { AlertFeature } from "../../lib/alerts";
import { hazardMeta } from "../../lib/hazard";
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

/** One full breath of the on-air pulse, in ms. */
const PULSE_PERIOD_MS = 1500;

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
}

/**
 * Weather-alert overlay, tuned to "shine out" on a broadcast globe. Each alert
 * area is drawn in several passes — a wide soft halo, a brighter mid glow, a
 * translucent fill and a crisp lit edge — so severe warnings glow against the
 * weather raster instead of blending into it. On top of every area (and each
 * point-source hazard) sits a hazard badge: a glowing dot tinted by hazard type
 * with the hazard glyph, so an operator reads *what* the warning is at a glance.
 * Severity (0 info … 4 extreme) scales the glow, the fill opacity and the badge.
 */
export function alertsLayer(features: AlertFeature[], visible = true) {
  const n = features.length;

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
    badges.push({ pos, rank: rank(f), color: rgb(meta.color), icon: meta.icon });
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
      getLineColor: (f: any) => withA(lighten(base(f), 0.35), 26),
      getLineWidth: (f: any) => 6 + rank(f) * 3,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: params,
      updateTriggers: { getLineColor: n, getLineWidth: n },
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
      getLineColor: (f: any) => withA(lighten(base(f), 0.2), 70),
      getLineWidth: (f: any) => 3 + rank(f) * 1.4,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 2.5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: params,
      updateTriggers: { getLineColor: n, getLineWidth: n },
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
      getFillColor: (f: any) => withA(base(f), 45 + rank(f) * 16),
      // Pickable so click-to-select works anywhere inside the alert area, not
      // just on the ~1px edge stroke (which is the only other pickable layer).
      pickable: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: params,
      updateTriggers: { getFillColor: n },
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
      getLineColor: (f: any) => withA(lighten(base(f), 0.55), 240),
      getLineWidth: (f: any) => 1.3 + rank(f) * 0.25,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 1,
      pickable: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: params,
      updateTriggers: { getLineColor: n, getLineWidth: n },
    }),
  ];

  if (badges.length) {
    // Badge radius (px), core grows with severity.
    const coreR = (b: Badge) => 6 + b.rank * 1.6;

    layers.push(
      // 5 ─ Badge halo — the "shine" behind the hazard dot.
      new ScatterplotLayer<Badge>({
        id: "alerts-badge-halo",
        data: badges,
        getPosition: (b) => [b.pos[0], b.pos[1], 0],
        getRadius: (b) => coreR(b) * 2.6,
        getFillColor: (b) => withA(lighten(b.color, 0.25), 38 + b.rank * 8),
        radiusUnits: "pixels",
        radiusMaxPixels: 60,
        stroked: false,
        pickable: false,
        parameters: DEPTH_TEST,
        updateTriggers: { getFillColor: badges.length, getRadius: badges.length },
      }),
      // 6 ─ Badge core — hazard-tinted dot with a bright rim.
      new ScatterplotLayer<Badge>({
        id: "alerts-badge-core",
        data: badges,
        getPosition: (b) => [b.pos[0], b.pos[1], 0],
        getRadius: (b) => coreR(b),
        getFillColor: (b) => withA(b.color, 235),
        getLineColor: (b) => [...lighten(b.color, 0.7), 255] as [number, number, number, number],
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
          getFillColor: badges.length,
          getLineColor: badges.length,
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
        getColor: [255, 255, 255, 255],
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
        updateTriggers: { getText: badges.length, getSize: badges.length },
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
 * pulse loop, so `now` drives the phase. When the on-air event has no drawn
 * polygon (point-only / geometry stripped) we fall back to a pulsing
 * hazard-coloured dot at the framing point.
 */
export function onAirPulseLayers(
  features: AlertFeature[],
  at: [number, number],
  now: number,
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
  const c: [number, number, number] = onAir ? base(onAir) : [255, 95, 95];
  const lit: [number, number, number] = lighten(c, 0.6);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [];

  // 1 ─ Breathe the on-air area itself, so the eye locks onto the exact shape.
  if (onAir && (onAir.geometry as { coordinates?: unknown })?.coordinates) {
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
  }

  // 2 ─ An expanding "sonar" ring at the framing point — bold, on top of
  //     everything, always shown while on air so the pulse is unmistakable even
  //     when the area is tiny or off the matched-polygon path.
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
    // 3 ─ A solid breathing core dot under the ring (anchors the ping; also the
    //     sole highlight when the on-air event has no drawn polygon).
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
