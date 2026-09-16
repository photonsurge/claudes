import { render, screen } from "@testing-library/react";
import EventNearbyPanel, {
  EventNearbyCityPanel,
  eventNearbyCityPages,
  eventNearbySlideHasContent,
} from "./EventNearbyPanel";
import type { City } from "../../lib/cities";
import type { Cam } from "../../lib/cams/types";

// The per-city climate strip fetches its own cached climate; not what's under
// test here, so it self-hides.
jest.mock("./CityHistory", () => ({
  FeaturedCityClimate: () => null,
  CityTempSpark: () => null,
}));

const city = (over: Partial<City>): City =>
  ({ id: "c", name: "Town", lat: 0, lng: 0, population: 100_000, ...over }) as unknown as City;

const CENTRE: [number, number] = [0, 0];

describe("near-this-event pages", () => {
  it("gives a slide only to cities that can fill one", () => {
    const rich = city({ id: "rich", name: "Rich", lng: 0.1, wikiExtract: "A city on a river." });
    const bare = city({ id: "bare", name: "Bare", lng: 0.2 });
    expect(eventNearbyCityPages(CENTRE, [rich, bare]).map((n) => n.item.id)).toEqual(["rich"]);
  });

  it("keeps the overview page for webcams, or for more than one city", () => {
    const bare = city({ id: "bare", lng: 0.2 });
    const cam = { camId: "cam1", title: "Harbour", lng: 0.1, lat: 0 } as unknown as Cam;
    // One bare city, nothing else — the old empty card, still dropped.
    expect(eventNearbySlideHasContent(CENTRE, [bare], [])).toBe(false);
    expect(eventNearbySlideHasContent(CENTRE, [bare], [cam])).toBe(true);
    expect(eventNearbySlideHasContent(CENTRE, [bare, city({ id: "b2", lng: 0.3 })], [])).toBe(true);
  });

  it("a city page reads that city alone, in full", () => {
    render(
      <EventNearbyCityPanel
        city={city({ name: "Riverport", country: "Chile", wikiExtract: "A port at the river mouth." })}
        distanceKm={42}
      />,
    );
    expect(screen.getByText("Riverport")).toBeInTheDocument();
    expect(screen.getByText("A port at the river mouth.")).toBeInTheDocument();
  });

  it("the overview page lists the cities and the webcams", () => {
    const cam = { camId: "cam1", title: "Harbour cam", lng: 0.1, lat: 0 } as unknown as Cam;
    render(
      <EventNearbyPanel
        center={CENTRE}
        cities={[city({ id: "a", name: "Alpha", lng: 0.1 }), city({ id: "b", name: "Beta", lng: 0.2 })]}
        cams={[cam]}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Harbour cam")).toBeInTheDocument();
  });
});
