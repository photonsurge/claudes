/**
 * PlacesEditor — the ordered list of a several-places video: add a country or
 * an area, reorder up and down, remove, and the "Main areas" quick-fill.
 */
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MAX_SHORT_PLACES, type ShortPlace } from "@photonsurge/shared/short-script";
import { COUNTRY_OPTIONS } from "../../../lib/shorts";
import PlacesEditor, { movePlace } from "./PlacesEditor";

/** The editor over its own state, reporting every change. */
function Harness({ initial = [], onChange }: { initial?: ShortPlace[]; onChange: (p: ShortPlace[]) => void }) {
  const [places, setPlaces] = useState<ShortPlace[]>(initial);
  return (
    <PlacesEditor
      places={places}
      onChange={(p) => {
        setPlaces(p);
        onChange(p);
      }}
    />
  );
}

const last = (fn: jest.Mock) => fn.mock.calls[fn.mock.calls.length - 1][0];
const rows = () => within(screen.getByRole("list", { name: "Places in order" })).getAllByRole("listitem").map((li) => li.textContent);

const pick = (label: string, option: RegExp | string) => {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
};

it("adds a country and an area, in the order added", () => {
  const onChange = jest.fn();
  render(<Harness onChange={onChange} />);
  expect(screen.getByText(/No places yet/)).toBeInTheDocument();
  pick("Area to add", "Europe");
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  pick("Add a", "Country");
  pick("Country to add", /Japan/);
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(last(onChange)).toEqual([
    { type: "area", id: "europe" },
    { type: "country", id: "japan" },
  ]);
  expect(rows()[0]).toMatch(/^Europe · area/);
  expect(rows()[1]).toMatch(/Japan · country/);
});

it("won't add a place twice", () => {
  render(<Harness initial={[{ type: "area", id: "europe" }]} onChange={jest.fn()} />);
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Area to add" }));
  expect(within(screen.getByRole("listbox")).getByRole("option", { name: "Europe" })).toHaveAttribute("aria-disabled", "true");
});

it("reorders up and down, and removes", () => {
  const onChange = jest.fn();
  const initial: ShortPlace[] = [
    { type: "area", id: "europe" },
    { type: "country", id: "usa" },
    { type: "area", id: "asia" },
  ];
  render(<Harness initial={initial} onChange={onChange} />);
  expect(screen.getByRole("button", { name: "Move Europe up" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move Asia down" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Move Asia up" }));
  expect(last(onChange).map((p: ShortPlace) => p.id)).toEqual(["europe", "asia", "usa"]);
  fireEvent.click(screen.getByRole("button", { name: "Move Europe down" }));
  expect(last(onChange).map((p: ShortPlace) => p.id)).toEqual(["asia", "europe", "usa"]);
  fireEvent.click(screen.getByRole("button", { name: /Remove .*United States/ }));
  expect(last(onChange).map((p: ShortPlace) => p.id)).toEqual(["asia", "europe"]);
});

it("fills the main areas in their order", () => {
  const onChange = jest.fn();
  render(<Harness initial={[{ type: "country", id: "uk" }]} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Main areas" }));
  expect(last(onChange)).toEqual([
    { type: "area", id: "europe" },
    { type: "country", id: "usa" },
    { type: "area", id: "asia" },
    { type: "country", id: "australia" },
    { type: "area", id: "africa" },
    { type: "area", id: "south_america" },
  ]);
  expect(rows()).toHaveLength(6);
});

it("stops adding at the most places a video takes", () => {
  const full = COUNTRY_OPTIONS.slice(0, MAX_SHORT_PLACES).map((c) => ({ type: "country" as const, id: c.id }));
  render(<Harness initial={full} onChange={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
});

it("movePlace leaves the list alone at either end", () => {
  const l: ShortPlace[] = [
    { type: "area", id: "a" },
    { type: "area", id: "b" },
  ];
  expect(movePlace(l, 0, -1)).toBe(l);
  expect(movePlace(l, 1, 1)).toBe(l);
  expect(movePlace(l, 0, 1).map((p) => p.id)).toEqual(["b", "a"]);
});
