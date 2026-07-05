import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { SeismoStationReading } from "../../lib/seismo/types";
import { DEPTH_TEST } from "./depth";

/**
 * Live seismograph-station markers — the real GSN stations the worker is
 * currently streaming near what's on air (see worker/src/seismo/loop.ts).
 * Distinct from the earthquake epicentre overlay (`seismic.ts`): those are
 * event points, these are instrument locations, shown with their site name
 * so the operator/viewer can see WHERE the trace in the SEISMIC MONITOR panel
 * is actually coming from. The station the panel currently has "on air" gets
 * a halo + brighter marker + label so the map and the panel agree.
 */
const keyOf = (s: Pick<SeismoStationReading, "net" | "sta" | "loc" | "cha">) => `${s.net}.${s.sta}.${s.loc}.${s.cha}`;

/** First segment of a "City, Region, Country" site name — short enough for a label. */
const shortName = (s: SeismoStationReading): string => s.siteName?.split(",")[0]?.trim() || `${s.net}.${s.sta}`;

export function seismographStationLayers(stations: SeismoStationReading[], activeKey?: string | null) {
  const active = stations.filter((s) => keyOf(s) === activeKey);

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
      getRadius: (d) => (keyOf(d) === activeKey ? 6 : 4),
      getFillColor: (d) => (keyOf(d) === activeKey ? [67, 217, 255, 255] : [160, 190, 215, 210]),
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
    new TextLayer<SeismoStationReading>({
      id: "seismograph-station-labels",
      data: stations,
      getPosition: (d) => [d.lng, d.lat, 0],
      getText: (d) => shortName(d),
      getColor: (d) => (keyOf(d) === activeKey ? [255, 255, 255, 255] : [200, 215, 230, 190]),
      getSize: (d) => (keyOf(d) === activeKey ? 12 : 10),
      sizeUnits: "pixels",
      getPixelOffset: [0, -12],
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      fontFamily: "system-ui, sans-serif",
      fontSettings: { sdf: true },
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 200],
      parameters: DEPTH_TEST,
      updateTriggers: { getColor: activeKey, getSize: activeKey },
    }),
  ];
}
