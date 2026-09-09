import { onAirPulseLayers } from "./alerts";
import type { AlertFeature } from "../../lib/alerts";

/** Minimal AlertFeature with the given geometry; hazard drives colour only. */
function feature(geometry: AlertFeature["geometry"]): AlertFeature {
  return {
    type: "Feature",
    geometry,
    properties: {
      id: "a1",
      source: "test",
      identifier: "TEST-1",
      event: "Test",
      severityRank: 3,
      hazard: "flood",
    },
  };
}

type L = { props: { id: string; visible?: boolean } };
const ids = (layers: L[]) => layers.map((l) => l.props.id);
/** The passes that actually draw — the on-air AREA pair is always present, hidden when unused. */
const visibleIds = (layers: L[]) => layers.filter((l) => l.props.visible !== false).map((l) => l.props.id);

describe("onAirPulseLayers", () => {
  const polygon = feature({
    type: "Polygon",
    // Unit square centred on [10,20]; centroid (repPoint) ≈ [10,20].
    coordinates: [
      [
        [9, 19],
        [11, 19],
        [11, 21],
        [9, 21],
        [9, 19],
      ],
    ],
  });

  it("pulses the outline and drops the location marker when the event has a drawn area", () => {
    const layers = onAirPulseLayers([polygon], [10, 20], 0) as L[];
    expect(visibleIds(layers)).toEqual(["alerts-onair-fill", "alerts-onair-edge"]);
    // No ping / dot marker sits on top of a real geo area.
    expect(ids(layers)).not.toContain("alerts-onair-ping");
    expect(ids(layers)).not.toContain("alerts-onair-dot");
  });

  it("shows the sonar ring + dot marker for a point-only alert (no drawable area)", () => {
    const point = feature({ type: "Point", coordinates: [30, 40] });
    const layers = onAirPulseLayers([point], [30, 40], 0) as L[];
    expect(visibleIds(layers)).toEqual(["alerts-onair-ping", "alerts-onair-dot"]);
    // The area pair is still mounted (shader pipelines stay warm), just hidden.
    expect(layers.find((l) => l.props.id === "alerts-onair-fill")?.props.visible).toBe(false);
  });

  it("falls back to the marker when no feature matches the framing point", () => {
    const layers = onAirPulseLayers([polygon], [120, -30], 0) as L[];
    expect(visibleIds(layers)).toEqual(["alerts-onair-ping", "alerts-onair-dot"]);
  });
});
