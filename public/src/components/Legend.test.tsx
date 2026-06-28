import { render, screen, fireEvent } from "@testing-library/react";
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
});
