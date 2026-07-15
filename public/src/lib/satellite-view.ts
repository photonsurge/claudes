/**
 * Friendly names for a satellite snapshot's VIEW — the `layer` field the worker stamps
 * from `SatelliteView` (satimg/frame.ts). Shared by the on-air media panels and the admin
 * alert detail so a heat raster is never mislabelled as an ordinary "pass": a heat alert is
 * captured as MODIS land-surface-temperature, not true-colour (see alerts/snapshot-select).
 */
const VIEW_LABEL: Record<string, string> = {
  truecolor: "Latest pass",
  landtemp: "Land surface temp",
};

/** Label for a snapshot view (`layer`), falling back to a sensible generic. */
export function satelliteViewLabel(layer?: string): string {
  return (layer && VIEW_LABEL[layer]) || "Latest pass";
}

/** Label for a snapshot, accounting for the side-by-side compare kind. */
export function snapshotLabel(kind: string, layer?: string): string {
  if (kind === "compare") return "Then → now";
  if (kind === "satellite") return satelliteViewLabel(layer);
  return kind;
}
