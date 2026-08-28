/**
 * DwellField — the shared rotation-dwell control: slider over the broadcast
 * range + typeable seconds override (commits on blur/Enter, reverts invalid).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import DwellField from "./DwellField";

const setup = (onChange = jest.fn()) => {
  render(
    <DwellField
      label="Rotation dwell"
      valueMs={16000}
      defaultMs={16000}
      minMs={6000}
      maxMs={40000}
      onChange={onChange}
    />,
  );
  return onChange;
};

describe("DwellField", () => {
  it("slider drag reports the new dwell in ms", () => {
    const onChange = setup();
    fireEvent.change(screen.getByRole("slider", { name: "Rotation dwell" }), {
      target: { value: "24000" },
    });
    expect(onChange).toHaveBeenCalledWith(24000);
  });

  it("typed seconds commit on blur, even beyond the slider range", () => {
    const onChange = setup();
    const secs = screen.getByRole("textbox", { name: "Rotation dwell seconds" });
    fireEvent.change(secs, { target: { value: "90" } });
    expect(onChange).not.toHaveBeenCalled(); // drafts locally, no per-keystroke commit
    fireEvent.blur(secs);
    expect(onChange).toHaveBeenCalledWith(90000);
  });

  it("Enter commits, fractional seconds round to whole ms", () => {
    const onChange = setup();
    const secs = screen.getByRole("textbox", { name: "Rotation dwell seconds" });
    fireEvent.change(secs, { target: { value: "7.5" } });
    fireEvent.keyDown(secs, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(7500);
  });

  it("garbage or non-positive input reverts to the committed value", () => {
    const onChange = setup();
    const secs = screen.getByRole("textbox", { name: "Rotation dwell seconds" });
    fireEvent.change(secs, { target: { value: "fast" } });
    fireEvent.blur(secs);
    fireEvent.change(secs, { target: { value: "0" } });
    fireEvent.blur(secs);
    expect(onChange).not.toHaveBeenCalled();
    expect(secs).toHaveValue("16");
  });
});
