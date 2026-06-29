import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Quake } from "../../lib/tracks/types";

/**
 * Earthquake overlay. Marker radius scales with magnitude (so big quakes read
 * instantly on a broadcast) and colour encodes hypocentre depth — shallow quakes
 * (felt hardest) are red, deep ones blue. M5+ get a translucent halo and a
 * magnitude label. depthTest off so quakes sit above the globe fill.
 */

/** Depth (km) → colour. Shallow = red, intermediate = orange, deep = blue. */
function depthColor(depthKm: number): [number, number, number] {
  if (depthKm < 70) return [239, 68, 68]; // shallow
  if (depthKm < 300) return [249, 115, 22]; // intermediate
  return [59, 130, 246]; // deep
}

/** Magnitude → marker radius in pixels (roughly area ∝ energy, clamped). */
const radiusPx = (mag: number): number => Math.max(2.5, mag * mag * 0.9);

export function seismicLayer(quakes: Quake[]) {
  const big = quakes.filter((q) => q.mag >= 5);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [
    // Halo behind the larger quakes for on-air emphasis.
    new ScatterplotLayer<Quake>({
      id: "seismic-halo",
      data: big,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: (d) => radiusPx(d.mag) * 2.2,
      getFillColor: (d) => [...depthColor(d.depthKm), 45] as [number, number, number, number],
      radiusUnits: "pixels",
      radiusMaxPixels: 140,
      stroked: false,
      pickable: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: { depthTest: false } as any,
      updateTriggers: { getFillColor: big.length, getRadius: big.length },
    }),
    new ScatterplotLayer<Quake>({
      id: "seismic",
      data: quakes,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: (d) => radiusPx(d.mag),
      getFillColor: (d) => [...depthColor(d.depthKm), 200] as [number, number, number, number],
      getLineColor: [255, 255, 255, 220],
      radiusUnits: "pixels",
      radiusMinPixels: 2,
      radiusMaxPixels: 60,
      lineWidthUnits: "pixels",
      getLineWidth: 1,
      lineWidthMinPixels: 0.5,
      stroked: true,
      pickable: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: { depthTest: false } as any,
      updateTriggers: { getFillColor: quakes.length, getRadius: quakes.length },
    }),
  ];

  if (big.length) {
    const labelProps = {
      id: "seismic-labels",
      data: big,
      getPosition: (d: Quake) => [d.lng, d.lat, 0],
      getText: (d: Quake) => `M${d.mag.toFixed(1)}`,
      getColor: [255, 255, 255, 235],
      getSize: 11,
      sizeUnits: "pixels",
      getPixelOffset: [0, -10],
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      fontFamily: "system-ui, sans-serif",
      fontSettings: { sdf: true },
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 200],
      parameters: { depthTest: false },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layers.push(new TextLayer(labelProps as any));
  }

  return layers;
}
