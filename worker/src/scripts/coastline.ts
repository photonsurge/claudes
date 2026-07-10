// scripts/coastline.ts
// Shared coastline helpers for the "eyeball" tools (check:maps, check:satimg): load
// the Natural Earth countries geojson and render it as a red SVG polyline overlay
// projected to a lat/lon bbox. No projection math beyond plate-carrée — these tools
// just draw the true coast over a baked raster so any misregistration is visible.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dataFile } from "../dataDir";

export const GEOJSON = dataFile("countries.geojson");

export type Bbox = [number, number, number, number];
export type Ring = [number, number][];

export function rings(geom: { type: string; coordinates: unknown }): Ring[] {
  if (geom.type === "Polygon") return geom.coordinates as Ring[];
  if (geom.type === "MultiPolygon") return (geom.coordinates as Ring[][]).flat();
  return [];
}

export async function loadCoastline(): Promise<Ring[]> {
  if (!existsSync(GEOJSON)) throw new Error(`coastline not found: ${GEOJSON} — run ./fetch-assets.sh`);
  const gj = JSON.parse(await readFile(GEOJSON, "utf8")) as {
    features: { geometry: { type: string; coordinates: unknown } }[];
  };
  return gj.features.flatMap((f) => rings(f.geometry));
}

/** Coastline as an SVG overlay (red polylines) sized to the output raster. */
export function coastlineSvg(coast: Ring[], bbox: Bbox, w: number, h: number, stroke = "#ff4646"): Buffer {
  const [west, south, east, north] = bbox;
  // Antimeridian-crossing windows carry east > 180 (e.g. rtofs-bering 155→211). The
  // coastline is in −180..180, so lift any lon west of the dateline by +360 into the
  // window's ascending frame before projecting.
  const wrap = (lo: number) => (east > 180 && lo < west ? lo + 360 : lo);
  const px = (lo: number, la: number) => [
    (((wrap(lo) - west) / (east - west)) * (w - 1)).toFixed(1),
    (((north - la) / (north - south)) * (h - 1)).toFixed(1),
  ];
  const lines: string[] = [];
  for (const ring of coast) {
    const pts = ring
      .filter(([lo, la]) => {
        const x = wrap(lo);
        return x >= west - 2 && x <= east + 2 && la >= south - 2 && la <= north + 2;
      })
      .map(([lo, la]) => px(lo, la).join(","));
    if (pts.length > 1)
      lines.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${stroke}" stroke-width="1"/>`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${lines.join("")}</svg>`);
}
