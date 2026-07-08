import type { TideStationReading } from "../../lib/tides/types";
import { stationMarkerLayers } from "./monitor-stations";

/**
 * Live tide-gauge markers — the coastal sea-level stations MonitorCluster's
 * TSUNAMI GAUGE / NEARBY TSUNAMI GAUGES panels are drawing from. Mirrors
 * layers/seismograph-stations.ts exactly: the gauge currently "on air" in
 * the panel gets a halo + brighter marker so the map and the panel agree.
 * Site-name labels are built as `OverlayLabel`s in Globe.tsx, same as seismo.
 */
export const tideKeyOf = (s: Pick<TideStationReading, "provider" | "stationId">) => `${s.provider}.${s.stationId}`;

/** Station name, short enough for a label. */
export const tideShortName = (s: TideStationReading): string => s.name;

export function tideStationLayers(stations: TideStationReading[], activeKey?: string | null) {
  return stationMarkerLayers(
    "tide-station",
    stations,
    (d) => [d.lng, d.lat, 0],
    (d) => tideKeyOf(d) === activeKey,
    [60, 150, 230],
    [160, 190, 215],
    activeKey,
  );
}
