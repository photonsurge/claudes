"use client";

/**
 * DEBUG overlay: outline each ACTIVE weather-map source's bbox on the globe and
 * label it with its sourceId, so the operator can SEE which model renders where
 * and check whether its coverage lines up with the coastline. The FINEST active
 * nest (the one that actually draws, single-winner) is drawn bright + thick and
 * tagged "▲ ACTIVE"; coarser active nests + the global base are dimmer.
 *
 * Pure selection via `resolveEntries` (same resolver the real layers use), so the
 * outlined boxes are exactly the sources in play at the current camera.
 */
import { PathLayer, TextLayer } from "@deck.gl/layers";
import type { WeatherManifest, WeatherVariableManifest } from "@photonsurge/shared/manifest";
import { resolveEntries, type ResolverCamera } from "./resolve";
import { manifestBounds } from "./props";
import { DEPTH_TEST } from "./depth";

/** Lift outlines above the surface so they hover clear of the basemap (z-fight). */
const ELEV = 32_000;

interface Box {
  path: [number, number, number][];
  label: string;
  labelAt: [number, number, number];
  color: [number, number, number, number];
  width: number;
}

/** A closed rectangle ring for a bbox, sampled along each edge so it curves on the globe. */
function ringFor(bbox: [number, number, number, number]): [number, number, number][] {
  const [w, s, e, n] = bbox;
  const pts: [number, number, number][] = [];
  const stepLng = Math.max(0.5, (e - w) / 60);
  const stepLat = Math.max(0.5, (n - s) / 60);
  for (let x = w; x < e; x += stepLng) pts.push([x, s, ELEV]);
  for (let y = s; y < n; y += stepLat) pts.push([e, y, ELEV]);
  for (let x = e; x > w; x -= stepLng) pts.push([x, n, ELEV]);
  for (let y = n; y > s; y -= stepLat) pts.push([w, y, ELEV]);
  pts.push([w, s, ELEV]);
  return pts;
}

/** Label a source entry with its id (fallback to its bbox for an unnamed base). */
function labelFor(e: WeatherVariableManifest): string {
  return e.sourceId ?? (e.bbox ? e.bbox.map((v) => v.toFixed(0)).join(",") : "base");
}

/**
 * Build the debug source-outline layers for the active variable at this camera.
 * Returns [] when there's no variable/manifest. Winner (finest active nest) is
 * highlighted; the global base bbox is drawn faint (it's ~the whole globe).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sourceDebugLayers(
  manifest: WeatherManifest | null,
  variableId: string | null,
  camera: ResolverCamera,
): any[] {
  if (!manifest || !variableId) return [];
  const entry = manifest.variables[variableId];
  if (!entry) return [];
  const entries = resolveEntries(entry, camera); // [base, ...activeNests] coarsest→finest
  if (!entries.length) return [];

  const winnerIdx = entries.length - 1; // finest active nest (or base, if no nest active)
  const boxes: Box[] = [];
  entries.forEach((e, i) => {
    // Base uses the manifest bounds (global); nests carry their own bbox.
    const bbox = (i === 0 ? manifestBounds(manifest) : e.bbox) as
      | [number, number, number, number]
      | undefined;
    if (!bbox) return;
    const isBase = i === 0;
    const isWinner = i === winnerIdx && !isBase;
    const color: [number, number, number, number] = isWinner
      ? [250, 220, 40, 255] // bright yellow — the map you're actually seeing here
      : isBase
        ? [125, 211, 252, 90] // faint blue — the global base
        : [125, 211, 252, 170]; // active-but-covered nest
    boxes.push({
      path: ringFor(bbox),
      label: `${labelFor(e)}${isWinner ? "  ▲ ACTIVE" : isBase ? "  (base)" : ""}`,
      labelAt: [bbox[0], bbox[3], ELEV], // NW corner
      color,
      width: isWinner ? 2.4 : 1.2,
    });
  });

  return [
    new PathLayer<Box>({
      id: "mapsource-outline",
      data: boxes,
      getPath: (d) => d.path,
      getColor: (d) => d.color,
      getWidth: (d) => d.width,
      widthUnits: "pixels",
      widthMinPixels: 1,
      widthMaxPixels: 3,
      parameters: DEPTH_TEST,
      pickable: false,
      updateTriggers: { getColor: boxes.map((b) => b.label).join("|") },
    }),
    new TextLayer<Box>({
      id: "mapsource-labels",
      data: boxes,
      getPosition: (d) => d.labelAt,
      getText: (d) => d.label,
      getColor: (d) => [d.color[0], d.color[1], d.color[2], 255],
      getSize: 12,
      sizeUnits: "pixels",
      getTextAnchor: "start",
      getAlignmentBaseline: "top",
      getPixelOffset: [4, 4],
      fontFamily: "ui-monospace, monospace",
      fontSettings: { sdf: true },
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 220],
      parameters: DEPTH_TEST,
      pickable: false,
      updateTriggers: { getText: boxes.map((b) => b.label).join("|") },
    }),
  ];
}
