import { fireEvent, render, screen } from "@testing-library/react";
import RegionsTable from "./RegionsTable";
import type { RegionWithWeather } from "../../lib/regions";

const atlantic = {
  id: "atl1",
  regionId: "atlantic",
  name: "Atlantic Ocean",
  group: "ocean",
  bbox: [-80, -60, 20, 70],
  wikiTitle: "Atlantic Ocean",
  wikiFetchedAt: new Date("2026-07-03T10:00:00Z"),
  weather: {
    generatedAt: new Date("2026-07-10T00:00:00Z"),
    stats: [{ variable: "temp", units: "°C", mean: 20, min: 15, max: 25, count: 3 }],
    hazards: [],
  },
} as unknown as RegionWithWeather;

it("links each region to its detail page and previews on select", () => {
  const onSelect = jest.fn();
  render(<RegionsTable regions={[atlantic]} totalCount={1} selectedId={null} onSelect={onSelect} />);

  expect(screen.getByRole("link", { name: "Atlantic Ocean" })).toHaveAttribute("href", "/regions/atlantic");
  expect(screen.getByText("20°C")).toBeInTheDocument();
  expect(screen.getByText("● Enriched")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Preview Atlantic Ocean" }));
  expect(onSelect).toHaveBeenCalledWith(atlantic);
});

it("shows a seed hint when the catalog is empty", () => {
  render(<RegionsTable regions={[]} totalCount={0} selectedId={null} onSelect={() => {}} />);
  expect(screen.getByText(/No regions seeded yet/)).toBeInTheDocument();
});
