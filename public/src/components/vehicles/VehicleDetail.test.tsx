import { render, screen } from "@testing-library/react";
import VehicleDetail from "./VehicleDetail";

const aircraft = {
  id: "aircraft:abc123",
  kind: "aircraft",
  code: "abc123",
  name: "SAM28000",
  label: "Air Force One",
  country: "United States",
  flag: "🇺🇸",
  wikiExtract: "A presidential aircraft.",
  wikiFetchedAt: 1_750_000_000_000,
  notable: true,
  timesSeen: 42,
  aircraftMeta: {
    registration: "82-8000",
    type: "Boeing VC-25A",
    typeCode: "B74L",
    operator: "United States Air Force",
    fetchedAt: 1_750_000_000_000,
  },
};

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ vehicle: aircraft }),
  })) as unknown as typeof fetch;
});

afterEach(() => jest.restoreAllMocks());

it("shows the aircraft record and the results from each enrichment source", async () => {
  render(<VehicleDetail id="aircraft:abc123" />);

  expect(await screen.findByRole("heading", { name: "Air Force One" })).toBeInTheDocument();
  expect(screen.getByText("Boeing VC-25A")).toBeInTheDocument();
  expect(screen.getByText("United States Air Force")).toBeInTheDocument();
  expect(screen.getByText("A presidential aircraft.")).toBeInTheDocument();
  expect(screen.getByText(/hexdb aircraft metadata/)).toBeInTheDocument();
  expect(screen.getByText(/Wikipedia summary/)).toBeInTheDocument();
  expect(screen.getByText(/Planespotters photo/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Re-run enrichment" })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith("/api/vehicles/aircraft%3Aabc123?path=0", { cache: "no-store" });
});
