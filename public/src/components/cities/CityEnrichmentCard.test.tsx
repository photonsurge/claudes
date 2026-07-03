import { render, screen } from "@testing-library/react";
import CityEnrichmentCard, { cityEnrichmentStatus } from "./CityEnrichmentCard";

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
  wikiExtract: "Paris is the capital and largest city of France.",
  wikiFetchedAt: new Date("2026-07-03T10:00:00Z"),
};

it("shows a city's stored Wikipedia enrichment result", () => {
  render(<CityEnrichmentCard city={paris} onClose={() => {}} />);

  expect(screen.getByText("★ Paris")).toBeInTheDocument();
  expect(screen.getByText(/Enriched/)).toBeInTheDocument();
  expect(screen.getByText("Paris is the capital and largest city of France.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open Wikipedia/ })).toHaveAttribute("href", "https://en.wikipedia.org/wiki/Paris");
});

it("distinguishes a checked miss from a city that has not been enriched", () => {
  expect(cityEnrichmentStatus({ ...paris, wikiTitle: undefined, wikiThumb: undefined, wikiExtract: undefined }).label).toBe("Checked — no match");
  expect(cityEnrichmentStatus({ ...paris, wikiTitle: undefined, wikiThumb: undefined, wikiExtract: undefined, wikiFetchedAt: undefined }).label).toBe("Not enriched");
});
