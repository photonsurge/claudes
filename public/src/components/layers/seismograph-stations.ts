import type { SeismoStationReading } from "../../lib/seismo/types";
import { stationMarkerLayers } from "./monitor-stations";

/**
 * Live seismograph-station markers — the real GSN stations the worker is
 * currently streaming near what's on air (see worker/src/seismo/loop.ts).
 * Distinct from the earthquake epicentre overlay (`seismic.ts`): those are
 * event points, these are instrument locations. The station the panel
 * currently has "on air" gets a halo + brighter marker so the map and the
 * SEISMIC MONITOR panel agree. Site-name labels are NOT a deck layer here —
 * deck's TextLayer renders blank under this app's _GlobeView build (see
 * layers/tracks.ts's note) — they're built as `OverlayLabel`s in Globe.tsx
 * and drawn by the same HTML-overlay GlobeLabels component tracks/cities use.
 */
export const seismoKeyOf = (s: Pick<SeismoStationReading, "net" | "sta" | "loc" | "cha">) =>
  `${s.net}.${s.sta}.${s.loc}.${s.cha}`;

/** First segment of a "City, Region, Country" site name — short enough for a label. */
export const seismoShortName = (s: SeismoStationReading): string =>
  s.siteName?.split(",")[0]?.trim() || `${s.net}.${s.sta}`;

export function seismographStationLayers(stations: SeismoStationReading[], activeKey?: string | null) {
  return stationMarkerLayers(
    "seismograph-station",
    stations,
    (d) => [d.lng, d.lat, 0],
    (d) => seismoKeyOf(d) === activeKey,
    [67, 217, 255],
    [160, 190, 215],
    activeKey,
  );
}
