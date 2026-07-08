import { render, screen } from "@testing-library/react";
import CityEnrichmentCard, { cityEnrichmentStatus } from "./CityEnrichmentCard";

const nativeFetch = globalThis.fetch;

const paris = {
  id: "paris",
  name: "Paris",
  country: "France",
  lat: 48.8566,
  lng: 2.3522,
  population: 2_100_000,
  isCapital: true,
  wikiTitle: "Paris",
  wikiThumb: "https://example.test/paris.jpg",
  wikiPhoto: "https://example.test/paris-full.jpg",
  wikiExtract: "Paris is the capital and largest city of France.",
  wikiGallery: ["https://example.test/g1.jpg", "https://example.test/g2.jpg"],
  wikiFetchedAt: new Date("2026-07-03T10:00:00Z"),
  foundedYear: 250,
  areaKm2: 105,
  elevationM: 35,
};

afterEach(() => {
  if (nativeFetch) {
    globalThis.fetch = nativeFetch;
  } else {
    Reflect.deleteProperty(globalThis, "fetch");
  }
});

it("shows a city's stored Wikipedia enrichment result", () => {
  render(<CityEnrichmentCard city={paris} onClose={() => {}} />);

  expect(screen.getByText("★ Paris")).toBeInTheDocument();
  expect(screen.getByText(/Enriched/)).toBeInTheDocument();
  expect(screen.getByText("Paris is the capital and largest city of France.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open Wikipedia/ })).toHaveAttribute("href", "https://en.wikipedia.org/wiki/Paris");

  const [mainPhoto] = screen.getAllByAltText("") as HTMLImageElement[];
  expect(mainPhoto.src).toContain("paris-full.jpg");
  expect(screen.getByText(/founded 250/)).toBeInTheDocument();
  expect(screen.getByText(/105 km²/)).toBeInTheDocument();
  expect(screen.getByText(/35 m elevation/)).toBeInTheDocument();
});

it("renders without a gallery when it's absent", () => {
  render(<CityEnrichmentCard city={{ ...paris, wikiGallery: undefined }} onClose={() => {}} />);
  expect(screen.getAllByAltText("")).toHaveLength(1);
});

it("shows the selected city's point forecast when available", async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      days: [
        {
          date: "2026-07-08",
          label: "TODAY",
          hiTemp: 25.2,
          loTemp: 14.8,
          windAvg: 4.3,
          gustMax: 8,
          precipChance: 40,
          cloudAvg: 55,
          condition: "partly-cloudy",
          hazards: [],
        },
      ],
    }),
  }) as typeof fetch;

  render(<CityEnrichmentCard city={paris} onClose={() => {}} />);

  expect(await screen.findByText("TODAY")).toBeInTheDocument();
  expect(screen.getByText("partly cloudy")).toBeInTheDocument();
  expect(screen.getByText(/40% rain/)).toBeInTheDocument();
  expect(screen.getByText(/4.3 m\/s wind/)).toBeInTheDocument();
  expect(globalThis.fetch).toHaveBeenCalledWith("/api/weather/forecast/point?lat=48.86&lng=2.35");
});

it("distinguishes a checked miss from a city that has not been enriched", () => {
  expect(cityEnrichmentStatus({ ...paris, wikiTitle: undefined, wikiThumb: undefined, wikiExtract: undefined }).label).toBe("Checked — no match");
  expect(cityEnrichmentStatus({ ...paris, wikiTitle: undefined, wikiThumb: undefined, wikiExtract: undefined, wikiFetchedAt: undefined }).label).toBe("Not enriched");
});
