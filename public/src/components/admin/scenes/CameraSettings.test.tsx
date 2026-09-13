/**
 * CameraSettings — the per-channel idle camera-motion editor: the master toggle
 * (idleMotion) plus how far it orbits/breathes and how fast (idleOrbit /
 * idleBreathe / idlePeriodS). All staged as deltas; every change also restamps
 * spinEpoch so the drift restarts smoothly from the anchor — except while some
 * other deterministic motion (autoSpin / director drift) owns the epoch.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import CameraSettings from "./CameraSettings";
import { renderInDraft } from "./draft-harness";

describe("CameraSettings", () => {
  it("enables idle motion with a fresh epoch (the delta carries both)", () => {
    const d = renderInDraft(<CameraSettings />);
    const toggle = screen.getByRole("checkbox", { name: "Keep the camera moving" });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    expect(d.last()).toEqual({ idleMotion: true, spinEpoch: expect.any(Number) });
  });

  it("changes the orbit radius (selects are live once motion is on)", () => {
    const d = renderInDraft(<CameraSettings />, { state: { idleMotion: true } });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Orbit" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Wide · 5°"));

    expect(d.last()).toEqual({ idleOrbit: 5, spinEpoch: expect.any(Number) });
  });

  it("changes the cycle speed", () => {
    const d = renderInDraft(<CameraSettings />, { state: { idleMotion: true } });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Cycle speed" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Slow · 90s"));

    expect(d.last()).toEqual({ idlePeriodS: 90, spinEpoch: expect.any(Number) });
  });

  it("does NOT restamp the epoch while the world spin owns it", () => {
    const d = renderInDraft(<CameraSettings />, { state: { autoSpin: true } });

    fireEvent.click(screen.getByRole("checkbox", { name: "Keep the camera moving" }));

    // Restamping would jump the accumulated spin longitude back to its anchor.
    expect(d.last()).toEqual({ idleMotion: true });
  });

  it("disables the amount selects while idle motion is off", () => {
    renderInDraft(<CameraSettings />);
    // MUI renders the select as a div — disabled surfaces as aria-disabled.
    expect(screen.getByLabelText("Orbit")).toHaveAttribute("aria-disabled", "true");
  });

  it("re-renders from its own staged edit", () => {
    renderInDraft(<CameraSettings />);
    expect(screen.getByLabelText("Orbit")).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(screen.getByRole("checkbox", { name: "Keep the camera moving" }));

    // The draft is the only copy of the edit, and the card reads it straight back.
    expect(screen.getByLabelText("Orbit")).not.toHaveAttribute("aria-disabled", "true");
  });
});
