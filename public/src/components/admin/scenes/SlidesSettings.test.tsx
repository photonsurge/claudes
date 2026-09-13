/**
 * SlidesSettings — the per-channel bottom-left deck editor: visibility (slidesOff),
 * order (slideOrder via ↑/↓), dwell (slideHoldMs) and the point-history variables.
 * All staged as deltas; the pinned on-air lede is locked.
 */
import { fireEvent, screen } from "@testing-library/react";
import SlidesSettings from "./SlidesSettings";
import { renderInDraft } from "./draft-harness";

describe("SlidesSettings", () => {
  it("hides a slide by unchecking it (the delta carries slidesOff)", () => {
    const d = renderInDraft(<SlidesSettings />);
    const forecast = screen.getByRole("checkbox", { name: "Forecast" });
    expect(forecast).toBeChecked();

    fireEvent.click(forecast);
    expect(d.last()).toEqual({ slidesOff: ["forecast"] });
  });

  it("locks the pinned on-air lede (checked + disabled, nothing staged)", () => {
    const d = renderInDraft(<SlidesSettings />);
    const onair = screen.getByRole("checkbox", { name: "On-air lede" });
    expect(onair).toBeChecked();
    expect(onair).toBeDisabled();
    expect(d.staged).toHaveLength(0);
  });

  it("reorders a slide down (the delta carries the full new order)", () => {
    const d = renderInDraft(<SlidesSettings />);
    // 'Track info' is the first non-pinned slide → moving it down swaps it with
    // the next catalog slide ('Area history').
    fireEvent.click(screen.getByRole("button", { name: "Move Track info down" }));

    expect(d.staged).toHaveLength(1);
    expect(d.last().slideOrder?.slice(0, 2)).toEqual(["history", "track"]);
  });

  it("changes the minimum dwell via the slider", () => {
    const d = renderInDraft(<SlidesSettings />);
    fireEvent.change(screen.getByRole("slider", { name: "Minimum dwell" }), {
      target: { value: "24000" },
    });

    expect(d.last()).toEqual({ slideHoldMs: 24000 });
  });

  it("types an exact dwell override in seconds", () => {
    const d = renderInDraft(<SlidesSettings />);
    const secs = screen.getByRole("textbox", { name: "Minimum dwell seconds" });
    fireEvent.change(secs, { target: { value: "45" } });
    fireEvent.blur(secs);

    expect(d.last()).toEqual({ slideHoldMs: 45000 });
  });

  it("hides a point-history variable via its checkbox", () => {
    const d = renderInDraft(<SlidesSettings />);
    const cape = screen.getByRole("checkbox", { name: "CAPE (storm energy)" });
    expect(cape).toBeChecked();

    fireEvent.click(cape);
    expect(d.last()).toEqual({ pointVarsOff: ["storm"] });
  });
});
