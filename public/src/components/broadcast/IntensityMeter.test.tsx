import { render, screen } from "@testing-library/react";
import IntensityMeter from "./IntensityMeter";
import { BROADCAST_THEMES } from "./config";
import type { MapFreshness } from "../../lib/manifest";

const UNITS = { wind: "kt", temp: "C" } as const;

const FRESHNESS: MapFreshness = {
  source: "ETOPO",
  updatedLabel: "48d ago",
  runLabel: "06 Jul 14:27 UTC",
  generatedLabel: "06 Jul 14:27 UTC",
};

describe("IntensityMeter — masthead plate", () => {
  it("renders hero, source chip, colour-scale ticks and the clocks slot on one plate", () => {
    render(
      <IntensityMeter
        part="masthead"
        variable="temp"
        units={UNITS}
        theme={BROADCAST_THEMES.command}
        freshness={FRESHNESS}
        clocks={<div data-testid="clock-slot" />}
      />,
    );
    expect(screen.getByText("Temperature")).toBeInTheDocument();
    expect(
      screen.getByText(
        "SOURCE ETOPO · CREATED 06 Jul 14:27 UTC (48d ago) · RUN 06 Jul 14:27 UTC",
      ),
    ).toBeInTheDocument();
    // The temp legend spans its domain — both extreme ticks are on the bar.
    expect(screen.getByText("-40 °C")).toBeInTheDocument();
    expect(screen.getByText("50 °C")).toBeInTheDocument();
    expect(screen.getByTestId("clock-slot")).toBeInTheDocument();
  });

  it("still shows a clocks-only plate when no scalar map is on air", () => {
    render(
      <IntensityMeter
        part="masthead"
        variable={null}
        units={UNITS}
        theme={BROADCAST_THEMES.command}
        clocks={<div data-testid="clock-slot" />}
      />,
    );
    expect(screen.getByTestId("clock-slot")).toBeInTheDocument();
    expect(screen.queryByText(/SOURCE/)).not.toBeInTheDocument();
  });

  it("renders nothing without a variable, satellite caption or clocks", () => {
    const { container } = render(
      <IntensityMeter
        part="masthead"
        variable={null}
        units={UNITS}
        theme={BROADCAST_THEMES.command}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("IntensityMeter — stacked fallback (brand off)", () => {
  it("renders the hero plate and scale pill, no clocks", () => {
    render(
      <IntensityMeter
        part="all"
        variable="temp"
        units={UNITS}
        theme={BROADCAST_THEMES.command}
        freshness={FRESHNESS}
      />,
    );
    expect(screen.getByText("Temperature")).toBeInTheDocument();
    expect(screen.getByText(/SOURCE ETOPO/)).toBeInTheDocument();
    expect(screen.getByText("-40 °C")).toBeInTheDocument();
  });
});
