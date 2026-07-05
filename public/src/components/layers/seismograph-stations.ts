import { ScatterplotLayer } from "@deck.gl/layers";
import type { SeismoStationReading } from "../../lib/seismo/types";
import { DEPTH_TEST } from "./depth";

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
  const active = stations.filter((s) => seismoKeyOf(s) === activeKey);

  return [
    // Halo behind the station currently driving the SEISMIC MONITOR trace.
    new ScatterplotLayer<SeismoStationReading>({
      id: "seismograph-station-halo",
      data: active,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: 18,
      getFillColor: [67, 217, 255, 70],
      radiusUnits: "pixels",
      stroked: false,
      pickable: false,
      parameters: DEPTH_TEST,
    }),
    new ScatterplotLayer<SeismoStationReading>({
      id: "seismograph-station-marker",
      data: stations,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: (d) => (seismoKeyOf(d) === activeKey ? 6 : 4),
      getFillColor: (d) => (seismoKeyOf(d) === activeKey ? [67, 217, 255, 255] : [160, 190, 215, 210]),
      stroked: true,
      getLineColor: [10, 18, 28, 220],
      lineWidthUnits: "pixels",
      getLineWidth: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 3,
      radiusMaxPixels: 8,
      pickable: true,
      parameters: DEPTH_TEST,
      updateTriggers: { getRadius: activeKey, getFillColor: activeKey },
    }),
  ];
}
