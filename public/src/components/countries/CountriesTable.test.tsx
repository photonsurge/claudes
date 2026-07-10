import { fireEvent, render, screen } from "@testing-library/react";
import CountriesTable from "./CountriesTable";
import type { CountryWithWeather } from "../../lib/countries";

const uk = {
  id: "uk1",
  countryId: "gb",
  name: "United Kingdom",
  iso2: "gb",
  continent: "Europe",
  subregion: "Northern Europe",
  bbox: [-8, 49, 2, 61],
  wikiTitle: "United Kingdom",
  wikiFetchedAt: new Date("2026-07-03T10:00:00Z"),
  weather: {
    generatedAt: new Date("2026-07-10T00:00:00Z"),
    stats: [{ variable: "temp", units: "°C", mean: 14, min: 10, max: 18, count: 5 }],
    hazards: [],
  },
} as unknown as CountryWithWeather;

it("links each country to its detail page and previews on select", () => {
  const onSelect = jest.fn();
  render(<CountriesTable countries={[uk]} totalCount={1} selectedId={null} onSelect={onSelect} />);

  expect(screen.getByRole("link", { name: /United Kingdom/ })).toHaveAttribute("href", "/countries/gb");
  expect(screen.getByText("14°C")).toBeInTheDocument();
  expect(screen.getByText("● Enriched")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Preview United Kingdom" }));
  expect(onSelect).toHaveBeenCalledWith(uk);
});

it("shows a seed hint when the catalog is empty", () => {
  render(<CountriesTable countries={[]} totalCount={0} selectedId={null} onSelect={() => {}} />);
  expect(screen.getByText(/No countries seeded yet/)).toBeInTheDocument();
});
