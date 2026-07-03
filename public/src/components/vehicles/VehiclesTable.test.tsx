import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VehiclesTable from "./VehiclesTable";

const vehicle = {
  id: "aircraft:abc123",
  kind: "aircraft",
  code: "abc123",
  name: "SAM28000",
  label: "Air Force One",
  country: "United States",
  flag: "🇺🇸",
  notable: true,
  enabled: true,
  timesSeen: 42,
  lastSeen: "2026-07-03T10:00:00.000Z",
  aircraftMeta: {
    registration: "82-8000",
    type: "Boeing VC-25A",
    operator: "United States Air Force",
    fetchedAt: 1_750_000_000_000,
  },
};

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ count: 1, total: 51, page: 1, pageSize: 25, pageCount: 3, vehicles: [vehicle] }),
  })) as unknown as typeof fetch;
});

afterEach(() => jest.restoreAllMocks());

it("renders server-paginated vehicles with links to their record page", async () => {
  render(<VehiclesTable />);

  const link = await screen.findByRole("link", { name: "Air Force One" });
  expect(link).toHaveAttribute("href", "/admin/vehicles/aircraft%3Aabc123");
  expect(screen.getByText(/Metadata/)).toBeInTheDocument();
  expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("page=1&pageSize=25&sort=lastSeen&direction=desc"),
    { cache: "no-store" },
  );
});

it("requests ordering and numbered pages from the server", async () => {
  render(<VehiclesTable />);
  await screen.findByRole("link", { name: "Air Force One" });

  fireEvent.click(screen.getByRole("button", { name: "Vehicle" }));
  await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(
    expect.stringContaining("sort=name&direction=asc"),
    { cache: "no-store" },
  ));

  fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
  await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(
    expect.stringContaining("page=2&pageSize=25&sort=name&direction=asc"),
    { cache: "no-store" },
  ));
});
