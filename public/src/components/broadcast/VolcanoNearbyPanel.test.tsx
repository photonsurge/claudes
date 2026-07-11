import { render, screen, waitFor } from "@testing-library/react";
import VolcanoNearbyPanel, { volcanoNearbySlideHasContent } from "./VolcanoNearbyPanel";
import type { City } from "../../lib/cities";
import type { Quake } from "@photonsurge/shared/tracks/types";
import type { AlertFeature } from "../../lib/alerts";

const CENTER: [number, number] = [14.999, 37.748]; // Etna

const cities: City[] = [
  { id: "c1", name: "Catania", country: "Italy", cc: "IT", lat: 37.5, lng: 15.09, population: 300_000 } as City,
];
const quakes: Quake[] = [
  { id: "q1", mag: 3.2, place: "5km SW of Etna", time: Date.UTC(2026, 6, 8, 10), lng: 15.0, lat: 37.7, depthKm: 4 },
];
const alerts: AlertFeature[] = [
  {
    type: "Feature",
    geometry: { type: "Point", coordinates: [15.0, 37.7] },
    properties: {
      id: "a1",
      source: "meteoalarm",
      identifier: "a1",
      event: "Ashfall Advisory",
      severityRank: 2,
      hazard: "volcano",
      areaDesc: "Sicily",
    },
  } as AlertFeature,
];

// The nearest-city rows now fetch each town's cached weather (/api/cities/weather
// ?ids=…); stub it so the effect resolves inside act.
beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ cities: [] }),
  })) as unknown as typeof fetch;
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("volcanoNearbySlideHasContent", () => {
  it("is false when nothing is within range", () => {
    expect(volcanoNearbySlideHasContent(CENTER, [], [], [])).toBe(false);
  });

  it("is true when any of cities/quakes/alerts is nearby", () => {
    expect(volcanoNearbySlideHasContent(CENTER, cities, [], [])).toBe(true);
    expect(volcanoNearbySlideHasContent(CENTER, [], quakes, [])).toBe(true);
    expect(volcanoNearbySlideHasContent(CENTER, [], [], alerts)).toBe(true);
  });
});

describe("VolcanoNearbyPanel", () => {
  it("renders nearby cities, seismic activity, and alerts", async () => {
    render(<VolcanoNearbyPanel center={CENTER} cities={cities} quakes={quakes} alerts={alerts} />);
    expect(screen.getByText("Catania")).toBeInTheDocument();
    expect(screen.getByText("M3.2")).toBeInTheDocument();
    expect(screen.getByText(/5km SW of Etna/)).toBeInTheDocument();
    expect(screen.getByText(/Ashfall Advisory/)).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it("renders nothing when nothing is within range", () => {
    const { container } = render(<VolcanoNearbyPanel center={CENTER} cities={[]} quakes={[]} alerts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
