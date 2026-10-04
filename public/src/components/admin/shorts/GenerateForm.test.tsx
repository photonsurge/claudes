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
  expect(generate).toHaveBeenCalledWith({ scope: { type: "globe" }, include: ROUNDUP_ONLY });
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
  expect(generate).toHaveBeenCalledWith({ scope: { type: "country", id: "japan" }, include: ROUNDUP_ONLY });
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
