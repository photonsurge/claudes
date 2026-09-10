import { ScatterplotLayer } from "@deck.gl/layers";
import { DEPTH_TEST } from "./depth";

type RGB = [number, number, number];

/**
 * Shared halo+dot marker pair for a "monitor" instrument point on the globe —
 * the currently-on-air point gets a soft halo behind a brighter dot, everything
 * else is a dim idle dot. Used identically by seismograph stations, tide
 * gauges, and the weather-monitor focus point so all three read as the same
 * "kind" of thing at a glance (see layers/seismograph-stations.ts and
 * layers/tide-stations.ts).
 */
export function stationMarkerLayers<T>(
  idPrefix: string,
  data: T[],
  getPosition: (d: T) => [number, number, number],
  isActive: (d: T) => boolean,
  activeColor: RGB,
  idleColor: RGB = [160, 190, 215],
  /** Primitive identity of "which one is active", e.g. a station key — used as
   *  the updateTriggers value so deck only rebuilds when it actually changes,
   *  not on every render. */
  activeKey?: string | null,
  /** Mounted but not drawn — the caller keeps the layers across a toggle so a
   *  cut that turns them back on costs no layer init. */
  visible = true,
) {
  const active = data.filter(isActive);

  return [
    new ScatterplotLayer<T>({
      id: `${idPrefix}-halo`,
      data: active,
      getPosition,
      getRadius: 18,
      getFillColor: [...activeColor, 70],
      radiusUnits: "pixels",
      stroked: false,
      pickable: false,
      parameters: DEPTH_TEST,
      visible,
    }),
    new ScatterplotLayer<T>({
      id: `${idPrefix}-marker`,
      data,
      getPosition,
      getRadius: (d) => (isActive(d) ? 6 : 4),
      getFillColor: (d) => (isActive(d) ? [...activeColor, 255] : [...idleColor, 210]),
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
      visible,
    }),
  ];
}
