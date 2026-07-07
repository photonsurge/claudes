import { render, screen, fireEvent } from "@testing-library/react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import Legend from "./Legend";

describe("Legend", () => {
  it("renders nothing when no variable is active", () => {
    const { container } = render(
      <Legend variableId={null} units={{ wind: "kt", temp: "C" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the variable label, a gradient and the unit", () => {
    render(<Legend variableId="temp" units={{ wind: "kt", temp: "C" }} />);
    expect(screen.getByText("Temperature")).toBeInTheDocument();
    expect(screen.getByTestId("legend-gradient")).toBeInTheDocument();
    expect(screen.getAllByText("°C").length).toBeGreaterThan(0);
  });

  it("toggles temperature units", () => {
    const onUnitsChange = jest.fn();
    render(
      <Legend variableId="temp" units={{ wind: "kt", temp: "C" }} onUnitsChange={onUnitsChange} />,
    );
    fireEvent.click(screen.getByText("Show °F"));
    expect(onUnitsChange).toHaveBeenCalledWith({ wind: "kt", temp: "F" });
  });

  it("toggles wind units for a wind-unit variable (gust)", () => {
    const onUnitsChange = jest.fn();
    render(
      <Legend variableId="gust" units={{ wind: "kt", temp: "C" }} onUnitsChange={onUnitsChange} />,
    );
    fireEvent.click(screen.getByText("Show m/s"));
    expect(onUnitsChange).toHaveBeenCalledWith({ wind: "m/s", temp: "C" });
  });

  it("shows data age when a manifest is supplied", () => {
    const manifest: WeatherManifest = {
      model: "GFS",
      run: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      bounds: [-180, -90, 180, 90],
      grid: { width: 1, height: 1, res: 1 },
      steps: [{ validTime: "a", fhr: 0 }],
      variables: {},
    };
    render(<Legend variableId="temp" units={{ wind: "kt", temp: "C" }} manifest={manifest} />);
    expect(screen.getByText(/GFS/)).toBeInTheDocument();
    expect(screen.getByText(/updated 3h ago/)).toBeInTheDocument();
  });

  it("omits data age when no manifest is supplied", () => {
    render(<Legend variableId="temp" units={{ wind: "kt", temp: "C" }} />);
    expect(screen.queryByText(/updated/)).not.toBeInTheDocument();
  });
});
