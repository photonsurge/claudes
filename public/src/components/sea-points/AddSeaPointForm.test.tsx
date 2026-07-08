import { act, fireEvent, render, screen } from "@testing-library/react";
import AddSeaPointForm from "./AddSeaPointForm";
import type { SeaPoint } from "../../lib/sea-points/types";

const saved: SeaPoint = {
  pointId: "gulf-stream",
  name: "Gulf Stream",
  blurb: "Warm western-boundary current, N. Atlantic",
  lat: 36,
  lng: -70,
  zoom: 4,
  depthCycle: false,
  enabled: true,
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => jest.restoreAllMocks());

function openForm(onSaved: (p: SeaPoint) => void = () => {}) {
  render(<AddSeaPointForm onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Add sea point" }));
}

it("stays collapsed until opened and cancels without posting", () => {
  global.fetch = jest.fn() as unknown as typeof fetch;
  render(<AddSeaPointForm onSaved={() => {}} />);

  expect(screen.queryByLabelText("Name*")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "+ Add sea point" }));
  expect(screen.getByLabelText("Name*")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByLabelText("Name*")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "+ Add sea point" })).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

it("posts the typed fields with defaults, reports the saved point and resets", async () => {
  global.fetch = jest.fn(async () => jsonResponse({ seaPoint: saved })) as unknown as typeof fetch;
  const onSaved = jest.fn();
  openForm(onSaved);

  fireEvent.change(screen.getByLabelText("Name*"), { target: { value: "Gulf Stream" } });
  fireEvent.change(screen.getByLabelText("Lat*"), { target: { value: "36" } });
  fireEvent.change(screen.getByLabelText("Lng*"), { target: { value: "-70" } });
  fireEvent.change(screen.getByLabelText("Blurb"), { target: { value: "Warm western-boundary current, N. Atlantic" } });
  fireEvent.click(screen.getByRole("button", { name: "Save sea point" }));

  // successful save collapses the form back to the opener button
  expect(await screen.findByRole("button", { name: "+ Add sea point" })).toBeInTheDocument();
  expect(onSaved).toHaveBeenCalledWith(saved);

  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe("/api/admin/sea-points");
  expect(init.method).toBe("POST");
  expect(init.headers).toEqual({ "Content-Type": "application/json" });
  const body = JSON.parse(init.body);
  expect(body).toEqual({
    name: "Gulf Stream",
    blurb: "Warm western-boundary current, N. Atlantic",
    lat: 36,
    lng: -70,
    zoom: 4,
    depthCycle: false,
    enabled: true,
  });
  // blank pointId is omitted entirely so the server auto-slugs from the name
  expect("pointId" in body).toBe(false);

  // reopening shows a cleared form
  fireEvent.click(screen.getByRole("button", { name: "+ Add sea point" }));
  expect(screen.getByLabelText("Name*")).toHaveValue("");
  expect(screen.getByLabelText("Lat*")).toHaveValue("");
});

it("sends an explicit pointId, numeric zoom and the checkbox choices", async () => {
  global.fetch = jest.fn(async () =>
    jsonResponse({ seaPoint: { ...saved, pointId: "custom-id", depthCycle: true, enabled: false, zoom: 5.5 } }),
  ) as unknown as typeof fetch;
  openForm();

  fireEvent.change(screen.getByLabelText("Name*"), { target: { value: "Niño 3.4" } });
  fireEvent.change(screen.getByLabelText("Point id"), { target: { value: "  custom-id  " } });
  fireEvent.change(screen.getByLabelText("Lat*"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Lng*"), { target: { value: "-145" } });
  fireEvent.change(screen.getByLabelText("Zoom"), { target: { value: "5.5" } });
  fireEvent.click(screen.getByLabelText(/Depth cycle/));
  fireEvent.click(screen.getByLabelText("Enabled"));
  fireEvent.click(screen.getByRole("button", { name: "Save sea point" }));

  await screen.findByRole("button", { name: "+ Add sea point" });
  const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
  expect(body).toMatchObject({
    pointId: "custom-id", // trimmed
    name: "Niño 3.4",
    lat: 0,
    lng: -145,
    zoom: 5.5,
    depthCycle: true,
    enabled: false,
  });
});

it("shows the API error, keeps the form open and skips onSaved", async () => {
  global.fetch = jest.fn(async () => jsonResponse({ error: "lat/lng out of range" }, 400)) as unknown as typeof fetch;
  const onSaved = jest.fn();
  openForm(onSaved);

  fireEvent.change(screen.getByLabelText("Name*"), { target: { value: "Bad point" } });
  fireEvent.change(screen.getByLabelText("Lat*"), { target: { value: "500" } });
  fireEvent.change(screen.getByLabelText("Lng*"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Save sea point" }));

  expect(await screen.findByText("lat/lng out of range")).toBeInTheDocument();
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save sea point" })).toBeInTheDocument();
  expect(screen.getByLabelText("Name*")).toHaveValue("Bad point");
});

it("falls back to a generic error when the response has no body", async () => {
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 500,
    json: async () => {
      throw new Error("not json");
    },
  })) as unknown as typeof fetch;
  openForm();

  fireEvent.click(screen.getByRole("button", { name: "Save sea point" }));
  expect(await screen.findByText("HTTP 500")).toBeInTheDocument();
});

it("disables the save button while the request is in flight", async () => {
  let release: (value: unknown) => void = () => {};
  global.fetch = jest.fn(
    () => new Promise((resolve) => { release = resolve; }),
  ) as unknown as typeof fetch;
  openForm();

  fireEvent.change(screen.getByLabelText("Name*"), { target: { value: "Slow point" } });
  fireEvent.click(screen.getByRole("button", { name: "Save sea point" }));

  const saving = await screen.findByRole("button", { name: "Saving…" });
  expect(saving).toBeDisabled();

  await act(async () => {
    release(jsonResponse({ seaPoint: saved }));
  });
  expect(screen.getByRole("button", { name: "+ Add sea point" })).toBeInTheDocument();
});
