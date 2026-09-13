/**
 * ReportSettings — per-channel World Report editor. Focus presets set reportOff
 * in one click; checkboxes toggle single slides; ↑/↓ reorder; a dwell picker
 * sets reportHoldMs; the weather slide's named locations live here too. All
 * staged as deltas.
 */
import { fireEvent, screen } from "@testing-library/react";
import ReportSettings from "./ReportSettings";
import { renderInDraft } from "./draft-harness";

describe("ReportSettings", () => {
  it("the 'Weather focus' preset curates BOTH slides and feed content in one click", () => {
    const d = renderInDraft(<ReportSettings />);

    fireEvent.click(screen.getByRole("button", { name: "Weather focus" }));
    expect(d.last()).toEqual({
      reportOff: ["seismic", "volcanoes"],
      reportKindsOff: ["quake", "volcano"],
    });
  });

  it("the 'Quakes & volcanoes' preset drops the weather slides + alert kind", () => {
    const d = renderInDraft(<ReportSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Quakes & volcanoes" }));
    expect(d.last()).toEqual({ reportOff: ["hourly", "alerts"], reportKindsOff: ["alert"] });
  });

  it("hides a whole event KIND from the feed + grid via its checkbox", () => {
    const d = renderInDraft(<ReportSettings />);
    const quakes = screen.getByRole("checkbox", { name: "Earthquakes" });
    expect(quakes).toBeChecked();

    fireEvent.click(quakes);
    expect(d.last()).toEqual({ reportKindsOff: ["quake"] });
  });

  it("hides a single slide via its checkbox", () => {
    const d = renderInDraft(<ReportSettings />);
    const seismic = screen.getByRole("checkbox", { name: "Seismic activity" });
    expect(seismic).toBeChecked();

    fireEvent.click(seismic);
    expect(d.last()).toEqual({ reportOff: ["seismic"] });
  });

  it("shows the alert-hazard filter only while the alert kind is on", () => {
    renderInDraft(<ReportSettings />);
    expect(screen.getByText("Alert hazards")).toBeInTheDocument();
  });

  it("hides the alert-hazard filter when the alert kind is off", () => {
    renderInDraft(<ReportSettings />, { state: { reportKindsOff: ["alert"] } });
    // The kind checkboxes render, so the card is mounted…
    expect(screen.getByRole("checkbox", { name: "Earthquakes" })).toBeInTheDocument();
    // …but with alerts off, the hazard sub-filter is gone.
    expect(screen.queryByText("Alert hazards")).not.toBeInTheDocument();
  });

  it("changes the report minimum dwell via the slider", () => {
    const d = renderInDraft(<ReportSettings />);
    fireEvent.change(screen.getByRole("slider", { name: "Report minimum dwell" }), {
      target: { value: "12000" },
    });

    expect(d.last()).toEqual({ reportHoldMs: 12000 });
  });

  it("types an exact report dwell override in seconds", () => {
    const d = renderInDraft(<ReportSettings />);
    const secs = screen.getByRole("textbox", { name: "Report minimum dwell seconds" });
    fireEvent.change(secs, { target: { value: "9" } });
    fireEvent.blur(secs);

    expect(d.last()).toEqual({ reportHoldMs: 9000 });
  });

  it("reorders a slide up (the delta carries the new order)", () => {
    const d = renderInDraft(<ReportSettings />);
    // 'Location weather' (hourly) is second → moving it up puts it before 'detection'.
    fireEvent.click(screen.getByRole("button", { name: "Move Location weather up" }));

    expect(d.last().reportOrder?.slice(0, 2)).toEqual(["hourly", "detection"]);
  });

  it("adds and edits chosen weather locations", () => {
    const d = renderInDraft(<ReportSettings />);
    expect(screen.getByText("Weather locations")).toBeInTheDocument();
    expect(screen.getByText(/With none selected, the slide follows the live camera/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add current view" }));
    expect(d.last()).toEqual({ weatherLocations: [{ label: "Location 1", lat: 20, lng: 0 }] });

    // The rename reads the just-staged location back out of the merged draft.
    fireEvent.change(screen.getByRole("textbox", { name: "Weather location 1 name" }), {
      target: { value: "Tashkent" },
    });
    expect(d.last()).toEqual({ weatherLocations: [{ label: "Tashkent", lat: 20, lng: 0 }] });
  });
});
