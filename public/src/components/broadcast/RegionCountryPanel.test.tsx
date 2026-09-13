import { render, screen } from "@testing-library/react";
import RegionCountryPanel from "./RegionCountryPanel";
import type { FocusRegionCountry } from "../../lib/focus/types";
import type { ForecastStep } from "../../lib/weather-forecast";

const HOUR = 3_600_000;

/** `count` 3-hourly steps starting `startH` hours from now, at a fixed reading. */
const steps = (startH: number, count: number, over: Record<string, unknown> = {}): ForecastStep[] =>
  Array.from({ length: count }, (_, i) => ({
    t: new Date(Date.now() + (startH + i * 3) * HOUR).toISOString(),
    dayKey: "2026-09-13",
    dayLabel: "Today",
    hourLabel: "12:00",
    temp: 20 + i,
    wind: 4,
    rain: 0,
    cloud: 40,
    gust: null,
    storm: null,
    condition: "clear",
    hazards: [],
    ...over,
  })) as unknown as ForecastStep[];

const country = (over: Partial<FocusRegionCountry> = {}): FocusRegionCountry =>
  ({
    cc: "ba",
    name: "Bosnia and Herzegovina",
    population: 3_200_000,
    sampleName: "Sarajevo",
    lat: 43.85,
    lng: 18.38,
    steps: steps(0, 25),
    days: [],
    cities: [],
    ...over,
  }) as unknown as FocusRegionCountry;

describe("RegionCountryPanel", () => {
  it("labels the heading and every chart with the window the forecast reaches", () => {
    render(<RegionCountryPanel country={country()} />);
    expect(screen.getByText("Next 72 Hours")).toBeInTheDocument();
    expect(screen.getByText(/TEMP · NEXT 72H/)).toBeInTheDocument();
    expect(screen.getByText(/WIND · NEXT 72H/)).toBeInTheDocument();
    expect(screen.getByText(/RAIN · NEXT 72H/)).toBeInTheDocument();
    expect(screen.getByText(/CLOUD · NEXT 72H/)).toBeInTheDocument();
  });

  it("says LAST, not NEXT, when the plotted steps have already elapsed", () => {
    // Elapsed forecast frames linger in the rolling store until the archive job
    // prunes them; the card must not sell yesterday's hours as an outlook.
    render(<RegionCountryPanel country={country({ steps: steps(-24, 9) })} />);
    expect(screen.getByText("Last 24 Hours")).toBeInTheDocument();
    expect(screen.getByText(/TEMP · LAST 24H/)).toBeInTheDocument();
    expect(screen.queryByText(/NEXT 24H/)).not.toBeInTheDocument();
  });

  it("claims only the hours a THIN store actually holds", () => {
    render(<RegionCountryPanel country={country({ steps: steps(0, 5) })} />);
    expect(screen.getByText("Next 12 Hours")).toBeInTheDocument();
    expect(screen.getByText(/TEMP · NEXT 12H/)).toBeInTheDocument();
  });

  it("lets a variable the store is short of frames for keep its OWN window", () => {
    // Wind drops out after 4 steps while temperature runs the full track: each
    // row states what it covers rather than riding its neighbour's horizon.
    const track = steps(0, 25).map((s, i) => ({ ...s, wind: i < 4 ? 4 : null }));
    render(<RegionCountryPanel country={country({ steps: track })} />);
    expect(screen.getByText(/TEMP · NEXT 72H/)).toBeInTheDocument();
    expect(screen.getByText(/WIND · NEXT 9H/)).toBeInTheDocument();
  });

  it("drops the whole chart section when nothing is plottable", () => {
    const track = steps(0, 25).map((s) => ({ ...s, temp: null, wind: null, rain: null, cloud: null }));
    render(<RegionCountryPanel country={country({ steps: track })} />);
    expect(screen.queryByText(/Hours$/)).not.toBeInTheDocument();
    expect(screen.getByText("Bosnia and Herzegovina")).toBeInTheDocument();
  });
});
