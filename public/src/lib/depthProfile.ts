/**
 * Vertical sea-temperature profile: sample the live temperature-at-depth
 * chapters (surface/100/500/2000/5000m) at a point, entirely client-side from
 * the already-decoded texture cache. Globe.tsx's `preloadTextures` warms
 * EVERY manifest variable up front (not just the active one), so this needs
 * no new network fetch — just `loadTexture` + `sampleFrame`
 * (@photonsurge/shared/weather/sample), the same pure decode module the
 * server-side history/forecast routes already use.
 */
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { sampleFrame } from "@photonsurge/shared/weather/sample";
import { getVariable } from "@photonsurge/shared/variables";
import { loadTexture } from "./textures";
import { textureUrlFor } from "../components/layers/props";

export interface DepthProfilePoint {
  depth: number;
  tempC: number;
  /** This chapter's own colour domain — deliberately NOT shared across depths
   *  (deep water's real range collapses toward near-freezing), so a caller
   *  colouring this point must use ITS domain, not a fixed -2..32 range, to
   *  stay consistent with how the same variable is coloured on the map. */
  domain: [number, number];
  palette: string;
}

/**
 * Depth chapters, shallow → deep. Every one is an RTOFS-family analysis-only
 * source (single step, fhr 0) — see worker/src/sources/rtofsDepth.ts.
 */
const DEPTH_CHAPTERS: Array<{ depth: number; variableId: string }> = [
  { depth: 0, variableId: "sst" },
  { depth: 100, variableId: "sst100" },
  { depth: 500, variableId: "sst500" },
  { depth: 2000, variableId: "sst2000" },
  { depth: 5000, variableId: "sst5000" },
];

/**
 * Sample the profile at [lat,lng]. Always reads fhr 0 regardless of the
 * ambient timeline position: every chapter is analysis-only, so following the
 * live forecast-hour scrubber would silently blank the profile whenever the
 * operator is browsing a forecast step. Returns null when fewer than 2
 * chapters have data at this point (e.g. a land point, where RTOFS bakes
 * nodata) — that absence IS the ocean-vs-land gate, the same "no data → no
 * chart" convention PointHistoryPanel already uses.
 */
export async function sampleDepthProfile(
  manifest: WeatherManifest,
  lat: number,
  lng: number,
): Promise<DepthProfilePoint[] | null> {
  const points: DepthProfilePoint[] = [];
  for (const { depth, variableId } of DEPTH_CHAPTERS) {
    const entry = manifest.variables[variableId];
    if (!entry) continue;
    const url = textureUrlFor(manifest, variableId, 0);
    if (!url) continue;
    let tex;
    try {
      tex = await loadTexture(url);
    } catch {
      continue; // texture failed to load — skip this chapter, not the whole profile
    }
    const bounds = entry.bbox ?? manifest.bounds;
    const res = (bounds[2] - bounds[0]) / tex.width;
    const sample = sampleFrame(
      {
        // TextureData.data is typed as Uint8Array | Uint8ClampedArray |
        // Float32Array, but every baked scalar PNG is 8-bit RGBA — the worker
        // never emits float textures — so this is always byte data at runtime.
        rgba: tex.data as Uint8Array,
        width: tex.width,
        height: tex.height,
        bounds,
        res,
        encoding: entry.encoding,
        imageUnscale: entry.imageUnscale,
      },
      lat,
      lng,
    );
    if (sample?.kind === "scalar") {
      const meta = getVariable(variableId);
      // Same domain/palette resolution scalarRasterPropsFromEntry uses to
      // colour this variable on the map (public/src/components/layers/props.ts).
      const domain = entry.domain ?? meta?.domain ?? [-2, 32];
      const palette = entry.palette ?? meta?.palette ?? "sst";
      points.push({ depth, tempC: sample.value, domain, palette });
    }
  }
  return points.length >= 2 ? points : null;
}
