import { render, screen } from "@testing-library/react";
import type { ForecastDay } from "../../lib/forecast-client";
import ForecastPanel, { windReading, dayCardLabel, stripTitle } from "./ForecastPanel";

// The panel fetches through the focus bundle; every case here feeds it days
// directly (daysOverride), so the hooks only need to exist.
jest.mock("../../lib/focus/focus-client", () => ({
  usePointForecastDays: () => ({ days: [], loading: false }),
  useAreaForecastDays: () => ({ days: [], loading: false }),
}));

const day = (over: Partial<ForecastDay> = {}): ForecastDay => ({
  date: "2026-09-16",
  label: "TODAY",
  hiTemp: 23.9,
  loTemp: 21.8,
  windAvg: 4.2,
  windMax: 6.4,
  windDir: 225,
  gustMax: 8,
  precipChance: 60,
  cloudAvg: 70,
  condition: "rain",
  hazards: [],
  ...over,
});

describe("windReading", () => {
  it("leads with the peak sustained wind", () => {
    expect(windReading({ wind: 6.4, gust: 8, dir: 225 })).toMatchObject({ speed: 6, calm: false, missing: false });
  });

  it("adds a gust chip only when the gust clears the sustained wind", () => {
    expect(windReading({ wind: 6, gust: 7, dir: null }).gust).toBeNull();
    expect(windReading({ wind: 6, gust: 14, dir: null }).gust).toBe(14);
  });

  it("falls back to the gust when the wind field itself is dead", () => {
    // The exact shape of the bug this card had: wind sampled as a flat zero
    // while the (separate, scalar) gust frames were fine.
    const r = windReading({ wind: 0, gust: 12, dir: null });
    expect(r.speed).toBeNull();
    expect(r.gust).toBe(12);
    expect(r.calm).toBe(false);
  });

  it("says CALM for a genuinely still day instead of printing 0", () => {
    const r = windReading({ wind: 0.1, gust: 0.2, dir: null });
    expect(r.calm).toBe(true);
    expect(r.speed).toBeNull();
  });

  it("reports nothing sampled as missing, not as calm", () => {
    expect(windReading({ wind: null, gust: null, dir: null })).toMatchObject({ missing: true, calm: false });
  });
});

describe("dayCardLabel", () => {
  it("keeps TODAY/TOMORROW and names the weekday for later days", () => {
    expect(dayCardLabel({ label: "TODAY", date: "2026-09-16" })).toBe("TODAY");
    expect(dayCardLabel({ label: "TOMORROW", date: "2026-09-17" })).toBe("TOMORROW");
    expect(dayCardLabel({ label: "+2", date: "2026-09-18" })).toBe("FRI");
  });
});

describe("stripTitle", () => {
  it("names the span actually rendered", () => {
    expect(stripTitle(3)).toBe("3-DAY FORECAST");
    expect(stripTitle(7)).toBe("7-DAY FORECAST");
  });
});

describe("ForecastPanel", () => {
  it("renders a day card with whole degrees, wind and precip", () => {
    render(<ForecastPanel center={null} daysOverride={[day()]} variant="monitor" />);
    expect(screen.getByText("1-DAY FORECAST")).toBeInTheDocument();
    expect(screen.getByText("24°")).toBeInTheDocument();
    expect(screen.getByText("22°")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("shows the gust when the wind reads zero, and CALM when both are still", () => {
    const { rerender } = render(
      <ForecastPanel center={null} daysOverride={[day({ windAvg: 0, windMax: 0, gustMax: 12 })]} variant="monitor" />,
    );
    expect(screen.getByText("G12")).toBeInTheDocument();
    expect(screen.queryByText("CALM")).not.toBeInTheDocument();

    rerender(
      <ForecastPanel center={null} daysOverride={[day({ windAvg: 0, windMax: 0, gustMax: 0 })]} variant="monitor" />,
    );
    expect(screen.getByText("CALM")).toBeInTheDocument();
  });

  it("shows an em dash when no wind was sampled at all", () => {
    render(
      <ForecastPanel center={null} daysOverride={[day({ windAvg: null, windMax: null, gustMax: null })]} variant="monitor" />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
