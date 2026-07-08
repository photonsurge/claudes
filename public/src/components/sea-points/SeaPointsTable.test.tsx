import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SeaPointsTable from "./SeaPointsTable";
import type { SeaPoint } from "../../lib/sea-points/types";

const gulfStream: SeaPoint = {
  pointId: "gulf-stream",
  name: "Gulf Stream",
  blurb: "Warm western-boundary current, N. Atlantic",
  lat: 36,
  lng: -70,
  zoom: 4.5,
  depthCycle: false,
  enabled: true,
};

const nino34: SeaPoint = {
  pointId: "nino-3-4",
  name: "Niño 3.4",
  blurb: "",
  lat: 0,
  lng: -145,
  zoom: 4,
  depthCycle: true,
  enabled: true,
};

const northSea: SeaPoint = {
  pointId: "north-sea",
  name: "North Sea",
  blurb: "Shallow shelf sea between Britain and Scandinavia",
  lat: 56,
  lng: 3,
  zoom: 4,
  depthCycle: false,
  enabled: false,
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockList(seaPoints: SeaPoint[]) {
  global.fetch = jest.fn(async () =>
    jsonResponse({ count: seaPoints.length, seaPoints }),
  ) as unknown as typeof fetch;
}

afterEach(() => jest.restoreAllMocks());

it("lists the whole catalog with no pagination cap", async () => {
  const many: SeaPoint[] = Array.from({ length: 300 }, (_, i) => ({
    ...gulfStream,
    pointId: `sp-${i}`,
    name: `Sea point ${i}`,
  }));
  mockList(many);

  render(<SeaPointsTable />);

  expect(await screen.findByText("300 of 300 sea points")).toBeInTheDocument();
  // header row + one row per point — everything renders, no page-size default
  expect(screen.getAllByRole("row")).toHaveLength(301);
  expect(global.fetch).toHaveBeenCalledWith("/api/admin/sea-points", { cache: "no-store" });
});

it("filters by name, case-insensitively, and reports the filtered count", async () => {
  mockList([gulfStream, nino34, northSea]);
  render(<SeaPointsTable />);
  await screen.findByText("3 of 3 sea points");

  fireEvent.change(screen.getByPlaceholderText("Search name"), { target: { value: "  NORTH " } });
  expect(screen.getByText("1 of 3 sea points")).toBeInTheDocument();
  expect(screen.getByText("North Sea")).toBeInTheDocument();
  expect(screen.queryByText("Gulf Stream")).not.toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText("Search name"), { target: { value: "zzz" } });
  expect(screen.getByText("0 of 3 sea points")).toBeInTheDocument();
  expect(screen.getByText("No matches.")).toBeInTheDocument();
});

it("shows the empty-catalog hint when there are no sea points", async () => {
  mockList([]);
  render(<SeaPointsTable />);
  expect(await screen.findByText("No sea points yet — add one above.")).toBeInTheDocument();
  expect(screen.getByText("0 of 0 sea points")).toBeInTheDocument();
});

it("surfaces a list-fetch error as a note", async () => {
  global.fetch = jest.fn(async () => jsonResponse({ error: "mongo down" }, 500)) as unknown as typeof fetch;
  render(<SeaPointsTable />);
  expect(await screen.findByText("mongo down")).toBeInTheDocument();
  expect(screen.getByText("No sea points yet — add one above.")).toBeInTheDocument();
});

it("toggles enabled via PATCH and reflects the server's row", async () => {
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PATCH") return jsonResponse({ seaPoint: { ...gulfStream, enabled: false } });
    return jsonResponse({ count: 1, seaPoints: [gulfStream] });
  }) as unknown as typeof fetch;

  render(<SeaPointsTable />);
  fireEvent.click(await screen.findByRole("button", { name: "● enabled" }));

  expect(await screen.findByRole("button", { name: "● disabled" })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    "/api/admin/sea-points/gulf-stream",
    expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) }),
  );
});

it("deletes a point, removes its row and closes its detail panel", async () => {
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "DELETE") return jsonResponse({ ok: true });
    return jsonResponse({ count: 2, seaPoints: [gulfStream, nino34] });
  }) as unknown as typeof fetch;

  render(<SeaPointsTable />);
  fireEvent.click(await screen.findByText("Gulf Stream"));
  expect(screen.getByText("36.000, -70.000 · zoom 4.5")).toBeInTheDocument();

  const row = screen.getByText("gulf-stream").closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: "delete" }));

  await waitFor(() => expect(screen.queryByText("Gulf Stream")).not.toBeInTheDocument());
  expect(screen.queryByText("36.000, -70.000 · zoom 4.5")).not.toBeInTheDocument();
  expect(screen.getByText("1 of 1 sea points")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith("/api/admin/sea-points/gulf-stream", { method: "DELETE" });
});

it("keeps the row and shows a note when a delete fails", async () => {
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "DELETE") return jsonResponse({ error: "point is on air" }, 409);
    return jsonResponse({ count: 1, seaPoints: [gulfStream] });
  }) as unknown as typeof fetch;

  render(<SeaPointsTable />);
  await screen.findByText("Gulf Stream");
  fireEvent.click(screen.getByRole("button", { name: "delete" }));

  expect(await screen.findByText("point is on air")).toBeInTheDocument();
  expect(screen.getByText("Gulf Stream")).toBeInTheDocument();
});

it("opens the detail panel on row click and closes it with ×", async () => {
  mockList([gulfStream, nino34]);
  render(<SeaPointsTable />);
  await screen.findByText("2 of 2 sea points");

  fireEvent.click(screen.getByText("Gulf Stream"));
  expect(screen.getByText("Warm western-boundary current, N. Atlantic")).toBeInTheDocument();
  expect(screen.getByText("36.000, -70.000 · zoom 4.5")).toBeInTheDocument();

  // switching selection: depth-cycle point with an empty blurb shows the — placeholder
  fireEvent.click(screen.getByText("Niño 3.4"));
  expect(screen.getByText("—", { selector: "div" })).toBeInTheDocument();
  expect(screen.getByText("0.000, -145.000 · zoom 4 · depth cycle")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "×" }));
  expect(screen.queryByText("0.000, -145.000 · zoom 4 · depth cycle")).not.toBeInTheDocument();
});

it("prepends and selects a point saved through the add form", async () => {
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "POST") return jsonResponse({ seaPoint: gulfStream });
    return jsonResponse({ count: 1, seaPoints: [nino34] });
  }) as unknown as typeof fetch;

  render(<SeaPointsTable />);
  await screen.findByText("1 of 1 sea points");

  fireEvent.click(screen.getByRole("button", { name: "+ Add sea point" }));
  fireEvent.change(screen.getByLabelText("Name*"), { target: { value: "Gulf Stream" } });
  fireEvent.change(screen.getByLabelText("Lat*"), { target: { value: "36" } });
  fireEvent.change(screen.getByLabelText("Lng*"), { target: { value: "-70" } });
  fireEvent.click(screen.getByRole("button", { name: "Save sea point" }));

  expect(await screen.findByText("2 of 2 sea points")).toBeInTheDocument();
  const rows = screen.getAllByRole("row");
  expect(rows[1]).toHaveTextContent("Gulf Stream"); // new point lands on top
  // ...and it is selected into the detail panel
  expect(screen.getByText("Warm western-boundary current, N. Atlantic")).toBeInTheDocument();
});
