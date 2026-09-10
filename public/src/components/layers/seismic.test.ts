import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { seismicLayer } from "./seismic";
import { seismographStationLayers } from "./seismograph-stations";
import type { Quake } from "../../lib/tracks/types";

const props = (l: unknown) => (l as { props: Record<string, unknown> }).props;
const quake = (mag: number): Quake => ({ id: `q${mag}`, mag, lat: 10, lng: 20, depthKm: 15, time: "2026-09-10T00:00:00Z" }) as unknown as Quake;

describe("seismicLayer — mounted across the director's toggle", () => {
  it("builds the four layers, all drawn, with the label layer present even without a big quake", () => {
    const layers = seismicLayer([quake(3.1)]);
    expect(layers.map((l) => props(l).id)).toEqual(["seismic-halo", "seismic-ring", "seismic-core", "seismic-labels"]);
    expect(layers[3]).toBeInstanceOf(TextLayer);
    expect(props(layers[3]).data).toEqual([]);
    for (const l of layers) expect(props(l).visible).toBe(true);
  });

  it("hidden: the same layers, none drawn — so turning them back on costs no init", () => {
    const layers = seismicLayer([quake(6.2)], false);
    expect(layers).toHaveLength(4);
    expect(layers[0]).toBeInstanceOf(ScatterplotLayer);
    expect(props(layers[3]).data).toHaveLength(1);
    for (const l of layers) expect(props(l).visible).toBe(false);
  });
});

describe("seismographStationLayers", () => {
  const station = { net: "IU", sta: "ANMO", loc: "00", cha: "BHZ", lat: 34.9, lng: -106.5 } as never;
  it("passes the visibility through to both marker layers", () => {
    for (const l of seismographStationLayers([station], null)) expect(props(l).visible).toBe(true);
    for (const l of seismographStationLayers([station], null, false)) expect(props(l).visible).toBe(false);
  });
});
