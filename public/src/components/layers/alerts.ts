import { GeoJsonLayer } from "@deck.gl/layers";
import { SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import type { AlertFeature } from "../../lib/alerts";

/** "#rrggbb" → [r,g,b]. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const FILL = Object.fromEntries(
  ([0, 1, 2, 3, 4] as SeverityRank[]).map((r) => [r, rgb(SEVERITY_COLORS[r])]),
) as Record<SeverityRank, [number, number, number]>;

const color = (rank: SeverityRank, alpha: number): [number, number, number, number] => {
  const c = FILL[rank] ?? [156, 163, 175];
  return [c[0], c[1], c[2], alpha];
};

/**
 * Weather-alert areas coloured by normalised severityRank (green→red). Polygon
 * sources (NWS/MeteoAlarm) render as translucent filled areas; point sources
 * (GDACS hazards — a flood/cyclone/wildfire centroid) render as solid markers so
 * they're visible on the globe instead of an invisible 1px dot.
 */
export function alertsLayer(features: AlertFeature[]) {
  return new GeoJsonLayer({
    id: "alerts",
    // Pass the array reference directly (stable between polls) — NOT a fresh
    // FeatureCollection wrapper each call, or deck re-tessellates every globe
    // rebuild (satellite/dead-reckon ticks) and the polygons flicker.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: features as any,
    filled: true,
    stroked: true,
    // Polygon fill is translucent; point markers want a solid core, so points
    // get their own opaque fill below via pointType/getPointRadius.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getFillColor: (f: any) =>
      f.geometry?.type === "Point"
        ? color(f.properties.severityRank as SeverityRank, 230)
        : color(f.properties.severityRank as SeverityRank, 70),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getLineColor: (f: any) => color(f.properties.severityRank as SeverityRank, 235),
    getLineWidth: 1.2,
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 1,
    // Point styling (GDACS centroids).
    pointType: "circle",
    pointRadiusUnits: "pixels",
    getPointRadius: (f: any) => 4 + (f.properties.severityRank as SeverityRank), // 4–8px by severity
    pointRadiusMinPixels: 4,
    pointRadiusMaxPixels: 11,
    pickable: true,
    // depthTest on so far-side alert areas are occluded by the basemap depth
    // sphere instead of bleeding through the front of the globe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: { depthTest: true } as any,
    updateTriggers: {
      getFillColor: features.length,
      getLineColor: features.length,
      getPointRadius: features.length,
    },
  });
}
