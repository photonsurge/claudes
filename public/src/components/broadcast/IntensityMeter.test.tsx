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
  it("renders hero, source line and colour-scale ticks on one plate", () => {
    render(
      <IntensityMeter
        part="masthead"
        variable="temp"
        units={UNITS}
        theme={BROADCAST_THEMES.command}
        freshness={FRESHNESS}
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
  });

  it("paints the paletteId override's ramp, not the variable's default", () => {
    // Height-coloured elevation contour LINES draw with the bright
    // `elevation_line` ramp — the scale must show it, not the relief fill ramp
    // (whose near-black abyss blue would be lifted for legibility here).
    render(
      <IntensityMeter
        part="masthead"
        variable="elevation"
        units={UNITS}
        theme={BROADCAST_THEMES.command}
        freshness={FRESHNESS}
        paletteId="elevation_line"
      />,
    );
    // Tick text takes the ramp colour at its stop: elevation_line starts #6f8cff.
    expect(screen.getByText("-11000 m")).toHaveStyle({ color: "#6f8cff" });
  });

  it("renders nothing without a variable or satellite caption", () => {
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

describe("IntensityMeter — stand-alone legend strip (brand off)", () => {
  it("renders the hero, source line and scale on one strip", () => {
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
