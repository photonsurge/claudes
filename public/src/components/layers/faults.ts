import { PathLayer } from "@deck.gl/layers";
import type { Fault } from "@photonsurge/shared/faults/types";
import { DEPTH_TEST } from "./depth";

/**
 * Tectonic plate-boundary overlay (Bird 2003 PB2002). A single PathLayer of the
 * boundary segments, drawn in a warm ember tone so they read as geology against
 * the cool basemap without competing with the live event overlays.
 *
 * depthTest is ON so far-side boundaries are occluded by the globe's depth
 * sphere instead of bleeding through the front (same convention as cables/
 * weather fills). The source paths are densely sampled, so they curve with the
 * sphere under deck's _GlobeView without us subdividing them.
 *
 * We deliberately draw lines only — the source's plate-pair codes ("AF-AN") are
 * not broadcast-friendly labels, so there's no TextLayer here.
 */

/** One drawable polyline: a single stretch of one boundary segment. */
interface FaultPath {
  path: [number, number][];
}

/** Warm ember tone for plate boundaries (RGB); alpha applied per-layer. */
const FAULT_COLOR: [number, number, number] = [255, 120, 48];

/** Flatten faults (each may have several stretches) into drawable paths. */
function toFaultPaths(faults: Fault[]): FaultPath[] {
  const out: FaultPath[] = [];
  for (const f of faults) {
    for (const path of f.paths) {
      if (path.length >= 2) out.push({ path });
    }
  }
  return out;
}

export function faultLayers(faults: Fault[]) {
  const paths = toFaultPaths(faults);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [
    new PathLayer<FaultPath>({
      id: "fault-lines",
      data: paths,
      getPath: (d) => d.path,
      getColor: [...FAULT_COLOR, 205] as [number, number, number, number],
      getWidth: 1.2,
      widthUnits: "pixels",
      widthMinPixels: 1,
      widthMaxPixels: 3,
      capRounded: true,
      jointRounded: true,
      pickable: false,
      parameters: DEPTH_TEST,
      updateTriggers: { getPath: paths.length },
    }),
  ];
  return layers;
}
