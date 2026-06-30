import { GeoJsonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import type { AlertFeature } from "../../lib/alerts";
import { hazardMeta } from "../../lib/hazard";

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

const FILL = Object.fromEntries(
  ([0, 1, 2, 3, 4] as SeverityRank[]).map((r) => [r, rgb(SEVERITY_COLORS[r])]),
) as Record<SeverityRank, [number, number, number]>;

const base = (rank: SeverityRank): [number, number, number] => FILL[rank] ?? [156, 163, 175];
const rank = (f: AlertFeature): SeverityRank => f.properties.severityRank;

const withA = (c: [number, number, number], a: number): [number, number, number, number] => [
  c[0],
  c[1],
  c[2],
  a,
];

/**
 * A representative lng/lat for an alert feature — where the hazard badge sits.
 * Point geometries use their coordinate; polygons use the centroid of the first
 * ring of the largest part (cheap, good enough for an on-screen marker).
 */
function repPoint(f: AlertFeature): [number, number] | null {
  const g = f.geometry;
  const co = g?.coordinates as unknown;
  if (!co) return null;
  if (g.type === "Point") return co as [number, number];
  // Polygon → coords[0] is the outer ring; MultiPolygon → coords[0][0].
  const ring: unknown =
    g.type === "MultiPolygon" ? (co as unknown[][][])[0]?.[0] : (co as unknown[][])[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let k = 0;
  for (const pt of ring as [number, number][]) {
    if (Array.isArray(pt) && pt.length >= 2) {
      sx += pt[0];
      sy += pt[1];
      k++;
    }
  }
  return k ? [sx / k, sy / k] : null;
}

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
export function alertsLayer(features: AlertFeature[]) {
  const n = features.length;

  // Badge anchor + hazard styling, computed once per feature.
  const badges: Badge[] = [];
  for (const f of features) {
    const pos = repPoint(f);
    if (!pos) continue;
    const meta = hazardMeta(f.properties.hazard);
    badges.push({ pos, rank: rank(f), color: rgb(meta.color), icon: meta.icon });
  }

  // Shared GeoJSON config — passed array reference is stable between polls, so
  // deck doesn't re-tessellate on every globe rebuild (dead-reckon ticks).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = features as any;
  // depthTest on so far-side areas are occluded by the basemap depth sphere
  // instead of bleeding through the front of the globe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params = { depthTest: true } as any;

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
      getLineColor: (f: any) => withA(lighten(base(rank(f)), 0.35), 26),
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
      getLineColor: (f: any) => withA(lighten(base(rank(f)), 0.2), 70),
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
      getFillColor: (f: any) => withA(base(rank(f)), 45 + rank(f) * 16),
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
      getLineColor: (f: any) => withA(lighten(base(rank(f)), 0.55), 240),
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
        // Badges sit above the globe fill so they never get depth-clipped.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parameters: { depthTest: false } as any,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parameters: { depthTest: false } as any,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parameters: { depthTest: false } as any,
        updateTriggers: { getText: badges.length, getSize: badges.length },
      }),
    );
  }

  return layers;
}
