/**
 * ColorField — text input + native-picker swatch + ✕ clear. Typing or picking
 * emits the value; clear emits "" (= inherit the preset); the swatch paints the
 * RESOLVED colour so an inherited field still shows what's in effect.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import ColorField from "./ColorField";

describe("ColorField", () => {
  it("typing emits the raw string", () => {
    const onChange = jest.fn();
    render(<ColorField label="Panel title colour" value="" resolved="#dfe7f5" onChange={onChange} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Panel title colour" }), {
      target: { value: "#123456" },
    });
    expect(onChange).toHaveBeenCalledWith("#123456");
  });

  it("the native picker emits its hex and starts from the resolved colour when inherited", () => {
    const onChange = jest.fn();
    render(<ColorField label="Accent colour" value="" resolved="#dfe7f5" onChange={onChange} />);

    const picker = screen.getByLabelText("Accent colour picker") as HTMLInputElement;
    expect(picker.value).toBe("#dfe7f5");
    fireEvent.change(picker, { target: { value: "#ff0000" } });
    expect(onChange).toHaveBeenCalledWith("#ff0000");
  });

  it("✕ clears back to inherit and only shows when overridden", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <ColorField label="LIVE badge colour" value="#00ff00" resolved="#00ff00" onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear LIVE badge colour" }));
    expect(onChange).toHaveBeenCalledWith("");

    rerender(<ColorField label="LIVE badge colour" value="" resolved="#ff3b3b" onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "Clear LIVE badge colour" })).not.toBeInTheDocument();
  });
});
