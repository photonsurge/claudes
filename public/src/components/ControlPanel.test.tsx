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
