/**
 * ChannelSettings — a checkbox per broadcast widget, checked = visible. Toggling
 * one stages a DELTA (widgetsOff) into the page's draft, and a widget already in
 * the off-list renders unchecked.
 */
import { fireEvent, screen } from "@testing-library/react";
import ChannelSettings from "./ChannelSettings";
import { renderInDraft } from "./draft-harness";

describe("ChannelSettings", () => {
  it("hides a widget by removing its check (the delta carries the off-list)", () => {
    const d = renderInDraft(<ChannelSettings />);

    const worldReport = screen.getByRole("checkbox", { name: "World Report" });
    expect(worldReport).toBeChecked();

    fireEvent.click(worldReport);

    expect(d.last()).toEqual({ widgetsOff: ["worldReport"] });
  });

  it("renders an already-hidden widget unchecked", () => {
    const d = renderInDraft(<ChannelSettings />, { state: { widgetsOff: ["seismic"] } });

    const seismic = screen.getByRole("checkbox", { name: "Seismic monitor" });
    expect(seismic).not.toBeChecked();

    // Re-checking it clears the off-list (shows everything again).
    fireEvent.click(seismic);
    expect(d.last()).toEqual({ widgetsOff: [] });
  });

  it("Hide all pushes every widget id into the off-list", () => {
    const d = renderInDraft(<ChannelSettings />);

    fireEvent.click(screen.getByRole("button", { name: "Hide all" }));

    expect(d.last().widgetsOff).toEqual(
      expect.arrayContaining(["worldReport", "seismic", "buildInfo"]),
    );
  });

  it("marks itself unsaved once something is staged", () => {
    renderInDraft(<ChannelSettings />);
    expect(screen.queryByText("• unsaved")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "World Report" }));

    expect(screen.getByText("• unsaved")).toBeInTheDocument();
  });
});
