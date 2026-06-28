import { render, screen, fireEvent } from "@testing-library/react";
import { DEFAULT_BASEMAP_COLORS } from "@photonsurge/shared/control";
import BasemapColorPicker from "./BasemapColorPicker";

describe("BasemapColorPicker", () => {
  it("renders the current colours", () => {
    render(<BasemapColorPicker value={DEFAULT_BASEMAP_COLORS} onChange={() => {}} />);
    expect((screen.getByLabelText("Ocean") as HTMLInputElement).value).toBe(
      DEFAULT_BASEMAP_COLORS.ocean,
    );
    expect((screen.getByLabelText("Land") as HTMLInputElement).value).toBe(
      DEFAULT_BASEMAP_COLORS.land,
    );
  });

  it("emits a patched colour set when one swatch changes", () => {
    const onChange = jest.fn();
    render(<BasemapColorPicker value={DEFAULT_BASEMAP_COLORS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Land"), { target: { value: "#112233" } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_BASEMAP_COLORS, land: "#112233" });
  });

  it("falls back to defaults when value is undefined and resets on demand", () => {
    const onChange = jest.fn();
    render(<BasemapColorPicker value={undefined} onChange={onChange} />);
    expect((screen.getByLabelText("Borders") as HTMLInputElement).value).toBe(
      DEFAULT_BASEMAP_COLORS.border,
    );
    fireEvent.click(screen.getByText("Reset"));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_BASEMAP_COLORS);
  });
});
