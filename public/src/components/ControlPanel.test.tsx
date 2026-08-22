/**
 * ControlPanel — the operator's per-channel widget toggles (in the Broadcast
 * chrome block) report a full ControlState up with the right widgetsOff off-list,
 * and hide entirely when broadcast chrome is off.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE, type ControlState } from "@photonsurge/shared/control";
import ControlPanel from "./ControlPanel";

const renderPanel = (over: Partial<ControlState> = {}) => {
  const onChange = jest.fn();
  render(
    <ControlPanel
      state={{ ...DEFAULT_CONTROL_STATE, ...over }}
      manifest={null}
      onChange={onChange}
      onFitBounds={jest.fn()}
    />,
  );
  return onChange;
};

describe("ControlPanel widget toggles", () => {
  it("hides a widget by unchecking it (reports the off-list on full state)", () => {
    const onChange = renderPanel();

    const group = screen.getByLabelText("Widgets");
    const worldReport = within(group).getByRole("checkbox", { name: "World Report" });
    expect(worldReport).toBeChecked();

    fireEvent.click(worldReport);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ widgetsOff: ["worldReport"] }),
    );
  });

  it("shows an already-hidden widget as unchecked and re-checking clears it", () => {
    const onChange = renderPanel({ widgetsOff: ["leftDeck"] });

    const group = screen.getByLabelText("Widgets");
    const leftDeck = within(group).getByRole("checkbox", { name: "Left card deck" });
    expect(leftDeck).not.toBeChecked();

    fireEvent.click(leftDeck);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ widgetsOff: [] }));
  });

  it("omits the widget group when broadcast chrome is off", () => {
    renderPanel({ showBroadcastChrome: false });
    expect(screen.queryByLabelText("Widgets")).not.toBeInTheDocument();
  });
});

describe("ControlPanel slide toggles", () => {
  it("hides a deck slide by unchecking it (reports slidesOff on full state)", () => {
    const onChange = renderPanel();
    const group = screen.getByLabelText("Slides");
    const forecast = within(group).getByRole("checkbox", { name: "Forecast" });
    expect(forecast).toBeChecked();

    fireEvent.click(forecast);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ slidesOff: ["forecast"] }));
  });

  it("does not offer the pinned on-air lede as a toggle", () => {
    renderPanel();
    const group = screen.getByLabelText("Slides");
    expect(within(group).queryByRole("checkbox", { name: "On-air lede" })).not.toBeInTheDocument();
  });

  it("changes the rotation dwell", () => {
    const onChange = renderPanel();
    fireEvent.change(screen.getByLabelText("Slide dwell"), { target: { value: "24000" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ slideHoldMs: 24000 }));
  });
});

describe("ControlPanel camera idle motion", () => {
  it("enables the parked-camera drift with a fresh epoch", () => {
    const onChange = renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "Keep moving" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ idleMotion: true, spinEpoch: expect.any(Number) }),
    );
  });

  it("does not restamp the epoch while a director push-in owns it", () => {
    const onChange = renderPanel({ zoomDrift: 0.04, spinEpoch: 123 });
    fireEvent.click(screen.getByRole("checkbox", { name: "Keep moving" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ idleMotion: true, spinEpoch: 123 }),
    );
  });

  it("hides the toggle while auto-spin is on (the spin already moves the camera)", () => {
    renderPanel({ autoSpin: true });
    expect(screen.queryByRole("checkbox", { name: "Keep moving" })).not.toBeInTheDocument();
  });
});

describe("ControlPanel world-report toggles", () => {
  it("a focus preset sets reportOff on the full state", () => {
    const onChange = renderPanel();
    const group = screen.getByLabelText("World report deck");
    fireEvent.click(within(group).getByRole("button", { name: "Weather focus" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        reportOff: ["seismic", "volcanoes"],
        reportKindsOff: ["quake", "volcano"],
      }),
    );
  });

  it("hides a report slide via its checkbox", () => {
    const onChange = renderPanel();
    const group = screen.getByLabelText("World report deck");
    fireEvent.click(within(group).getByRole("checkbox", { name: "Volcanic activity" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reportOff: ["volcanoes"] }));
  });
});
