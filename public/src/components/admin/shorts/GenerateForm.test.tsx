/**
 * GenerateForm — scope picking, the request it sends (round-up only), progress
 * while the worker runs, and the worker's message shown verbatim on failure.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import GenerateForm from "./GenerateForm";

const ROUNDUP_ONLY = { alerts: false, quakes: false, volcanoes: false };

it("generates a globe round-up by default and reports the saved draft", async () => {
  const generate = jest.fn().mockResolvedValue({ ok: true, data: { id: "s1", title: "World round-up", clips: 2, durationMs: 75_000 } });
  const onGenerated = jest.fn();
  render(<GenerateForm onGenerated={onGenerated} generate={generate} />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  });
  expect(generate).toHaveBeenCalledWith({ formatId: "shorts", scope: { type: "globe" }, include: ROUNDUP_ONLY });
  expect(onGenerated).toHaveBeenCalledWith({ id: "s1", title: "World round-up", clips: 2, durationMs: 75_000 });
  expect(screen.getByText(/Saved “World round-up” — 2 clip\(s\), 1:15/)).toBeInTheDocument();
});

it("picks a country from the full catalog", async () => {
  const generate = jest.fn().mockResolvedValue({ ok: true, data: { id: "s1", title: "J", clips: 1, durationMs: 1000 } });
  render(<GenerateForm onGenerated={jest.fn()} generate={generate} />);

  fireEvent.click(screen.getByRole("button", { name: "Country" }));
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Country" }));
  const listbox = screen.getByRole("listbox");
  expect(within(listbox).getAllByRole("option").length).toBeGreaterThan(20);
  fireEvent.click(within(listbox).getByRole("option", { name: /Japan/ }));

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  });
  expect(generate).toHaveBeenCalledWith({ formatId: "shorts", scope: { type: "country", id: "japan" }, include: ROUNDUP_ONLY });
});

it("shows progress while running and the worker's error as-is", async () => {
  let finish: (v: unknown) => void = () => {};
  const generate = jest.fn().mockReturnValue(new Promise((r) => (finish = r)));
  const onGenerated = jest.fn();
  render(<GenerateForm onGenerated={onGenerated} generate={generate} />);

  fireEvent.click(screen.getByRole("button", { name: "Area" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  expect(screen.getByRole("progressbar", { name: "Generating" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Generating…" })).toBeDisabled();
  expect(generate.mock.calls[0][0].scope.type).toBe("area");

  const msg = "No usable round-up for Northern Europe — switch it on at /admin/place-roundups";
  await act(async () => finish({ ok: false, error: msg }));
  expect(screen.getByRole("alert")).toHaveTextContent(msg);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(onGenerated).not.toHaveBeenCalled();
});

it("offers a format picker when there is more than one format, and sends the pick", async () => {
  const generate = jest.fn().mockResolvedValue({ ok: true, data: { id: "s1", title: "W", clips: 1, durationMs: 1000 } });
  const formats = [
    { id: "shorts", name: "Round-up" },
    { id: "short-brief", name: "Brief" },
  ];
  render(<GenerateForm onGenerated={jest.fn()} generate={generate} formats={formats} />);
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Format" }));
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Brief" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  });
  expect(generate.mock.calls[0][0].formatId).toBe("short-brief");
});

it("has no format picker with only the default format", () => {
  render(<GenerateForm onGenerated={jest.fn()} formats={[{ id: "shorts", name: "Round-up" }]} />);
  expect(screen.queryByRole("combobox", { name: "Format" })).toBeNull();
});

it("Render… hands the format and scope to the Render form instead of generating", () => {
  const generate = jest.fn();
  const onRender = jest.fn();
  render(<GenerateForm onGenerated={jest.fn()} onRender={onRender} generate={generate} />);
  fireEvent.click(screen.getByRole("button", { name: "Render…" }));
  expect(onRender).toHaveBeenCalledWith({ formatId: "shorts", scope: { type: "globe" }, include: ROUNDUP_ONLY });
  expect(generate).not.toHaveBeenCalled();
});

describe("several places", () => {
  it("fills the main areas, sends them in order with the format's world setting, and names the places left out", async () => {
    const generate = jest.fn().mockResolvedValue({
      ok: true,
      data: {
        id: "s9",
        title: "Europe, United States, Asia and 2 more round-up",
        clips: 6,
        durationMs: 300_000,
        skipped: [{ place: "area:africa", name: "Africa", reason: "no usable round-up" }],
      },
    });
    const formats = [
      { id: "shorts", name: "Round-up" },
      { id: "short-main", name: "Main areas", openWithWorld: true },
    ];
    render(<GenerateForm onGenerated={jest.fn()} generate={generate} formats={formats} />);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Format" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Main areas" }));

    fireEvent.click(screen.getByRole("button", { name: "Several places" }));
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled(); // no places yet
    fireEvent.click(screen.getByRole("button", { name: "Main areas" }));
    expect(screen.getByRole("switch", { name: "Open on the world round-up" })).toBeChecked();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    });
    expect(generate).toHaveBeenCalledWith({
      formatId: "short-main",
      include: ROUNDUP_ONLY,
      openWithWorld: true,
      scope: {
        type: "places",
        places: [
          { type: "area", id: "europe" },
          { type: "country", id: "usa" },
          { type: "area", id: "asia" },
          { type: "country", id: "australia" },
          { type: "area", id: "africa" },
          { type: "area", id: "south_america" },
        ],
      },
    });
    expect(screen.getByText(/Left out: Africa \(no usable round-up\)/)).toBeInTheDocument();
  });

  it("the world switch overrides the format for this generate", async () => {
    const generate = jest.fn().mockResolvedValue({ ok: true, data: { id: "s", title: "t", clips: 2, durationMs: 1 } });
    render(<GenerateForm onGenerated={jest.fn()} generate={generate} />);
    fireEvent.click(screen.getByRole("button", { name: "Several places" }));
    fireEvent.click(screen.getByRole("button", { name: "Main areas" }));
    const world = screen.getByRole("switch", { name: "Open on the world round-up" });
    expect(world).not.toBeChecked();
    fireEvent.click(world);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    });
    expect(generate.mock.calls[0][0].openWithWorld).toBe(true);
  });
});
