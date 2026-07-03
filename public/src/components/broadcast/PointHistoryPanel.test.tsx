import { render, screen, waitFor } from "@testing-library/react";
import PointHistoryPanel, { formatReading, sparkPoints } from "./PointHistoryPanel";
import { orderHistoryVariables, bboxForCamera } from "../../lib/history-client";
import type { HistorySeries } from "../../lib/weather-history";

const seriesOf = (variable: string, values: number[], units = "°C"): HistorySeries => ({
  variable,
  encoding: "scalar",
  units,
  lat: 51.5,
  lng: -0.1,
  series: values.map((v, i) => ({
    t: new Date(Date.UTC(2026, 6, 1, i * 3)).toISOString(),
    model: "gfs",
    fhr: 0,
    value: v,
  })),
  stats: {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
  },
});

const areaSeriesOf = (variable: string, means: number[], units = "°C") => ({
  variable,
  encoding: "scalar",
  units,
  bbox: [0, 40, 20, 55],
  series: means.map((m, i) => ({
    t: new Date(Date.UTC(2026, 6, 1, i * 3)).toISOString(),
    model: "gfs",
    fhr: 0,
    mean: m,
    min: m - 5,
    max: m + 5,
  })),
  stats: {
    count: means.length,
    min: Math.min(...means),
    max: Math.max(...means),
    avg: means.reduce((a, b) => a + b, 0) / means.length,
  },
  areaMin: Math.min(...means) - 5,
  areaMax: Math.max(...means) + 5,
});

const monthlyClimate = {
  lat: 51.5,
  lng: -0.1,
  granularity: "monthly",
  datasets: [
    {
      variable: "temp",
      units: "°C",
      buckets: [
        { key: "2025-08", mean: 18, min: 12, max: 27, sum: 540, count: 30, value: 18 },
        { key: "2025-12", mean: 5, min: -3, max: 11, sum: 150, count: 31, value: 5 },
        { key: "2026-06", mean: 17, min: 9, max: 29, sum: 510, count: 30, value: 17 },
      ],
    },
    {
      variable: "tempMax",
      units: "°C",
      buckets: [{ key: "2025-08", mean: 24, min: 20, max: 31, sum: 720, count: 30, value: 31 }],
    },
    {
      variable: "tempMin",
      units: "°C",
      buckets: [{ key: "2025-12", mean: 1, min: -6, max: 6, sum: 31, count: 31, value: -6 }],
    },
    {
      variable: "humidity",
      units: "%",
      buckets: [
        { key: "2025-08", mean: 62, min: 40, max: 90, sum: 1860, count: 30, value: 62 },
        { key: "2026-06", mean: 70, min: 45, max: 95, sum: 2100, count: 30, value: 70 },
      ],
    },
  ],
};

/** fetch stub covering /variables, /point, /area and /climate. */
function stubFetch({
  point = {},
  area = {},
  climate = null,
}: {
  point?: Record<string, unknown>;
  area?: Record<string, unknown>;
  climate?: unknown;
}) {
  const variables = [...new Set([...Object.keys(point), ...Object.keys(area)])];
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("/history/variables")) {
      return { ok: true, json: async () => ({ variables, count: 1 }) } as any;
    }
    if (url.includes("/history/climate")) {
      return climate
        ? ({ ok: true, json: async () => climate } as any)
        : ({ ok: false, json: async () => ({}) } as any);
    }
    const variable = new URL(url, "http://x").searchParams.get("variable")!;
    const body = url.includes("/history/area") ? area[variable] : point[variable];
    return { ok: !!body, json: async () => body } as any;
  }) as any;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PointHistoryPanel (point mode)", () => {
  it("renders a chart with latest value and stats per archived dataset", async () => {
    stubFetch({
      point: {
        temp: seriesOf("temp", [10, 14, 12]),
        pressure: seriesOf("pressure", [1010, 1008, 1013], "hPa"),
      },
    });
    render(<PointHistoryPanel center={[-0.1, 51.5]} />);
    await waitFor(() => expect(screen.getByText("POINT HISTORY")).toBeInTheDocument());
    expect(screen.getByText("TEMPERATURE")).toBeInTheDocument();
    expect(screen.getByText("PRESSURE")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument(); // latest temp
    expect(screen.getByText(/avg 12 · min 10 · max 14/)).toBeInTheDocument();
  });

  it("hides entirely when archive and climate both have nothing", async () => {
    stubFetch({});
    const { container } = render(<PointHistoryPanel center={[-0.1, 51.5]} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("drops single-point series (no trend to draw)", async () => {
    stubFetch({ point: { temp: seriesOf("temp", [10]) } });
    const { container } = render(<PointHistoryPanel center={[-0.1, 51.5]} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});

describe("PointHistoryPanel (area mode)", () => {
  it("uses the area endpoint and captions spatial extremes", async () => {
    stubFetch({ area: { temp: areaSeriesOf("temp", [10, 20]) } });
    render(<PointHistoryPanel center={[10, 47.5]} bbox={[0, 40, 20, 55]} />);
    await waitFor(() => expect(screen.getByText("AREA HISTORY")).toBeInTheDocument());
    expect(screen.getByText(/area lo 5 · hi 25/)).toBeInTheDocument();
    const calls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/history/area"))).toBe(true);
    expect(calls.some((u) => u.includes("/history/point"))).toBe(false);
  });
});

describe("PointHistoryPanel (past year)", () => {
  it("renders monthly ERA5 temp + humidity charts with year extremes", async () => {
    stubFetch({ climate: monthlyClimate });
    render(<PointHistoryPanel center={[-0.1, 51.5]} />);
    await waitFor(() => expect(screen.getByText("PAST YEAR")).toBeInTheDocument());
    expect(screen.getByText("TEMP · YEAR")).toBeInTheDocument();
    expect(screen.getByText("HUMIDITY · YEAR")).toBeInTheDocument();
    expect(screen.getByText(/yr hi 31 · lo -6/)).toBeInTheDocument();
    // tempMax/tempMin feed captions but never get their own chart.
    expect(screen.queryByText(/TEMPMAX/i)).toBeNull();
  });
});

describe("orderHistoryVariables", () => {
  it("keeps the fixed identity order, appends unknowns, drops elevation", () => {
    expect(orderHistoryVariables(["pressure", "elevation", "zeta", "temp"])).toEqual([
      "temp",
      "pressure",
      "zeta",
    ]);
  });
});

describe("bboxForCamera", () => {
  it("halves the span per zoom level and clamps near the poles", () => {
    const wide = bboxForCamera([0, 0], 1);
    expect(wide[2] - wide[0]).toBeCloseTo(120, 5); // clamped at 120°
    const tight = bboxForCamera([10, 84], 6);
    expect(tight[3]).toBe(85); // never past the pole
    expect(tight[2] - tight[0]).toBeCloseTo(6, 5); // floor at 6°
  });

  it("wraps across the antimeridian", () => {
    const seam = bboxForCamera([175, 0], 4);
    expect(seam[0]).toBeLessThanOrEqual(180);
    expect(seam[2]).toBeLessThan(seam[0]); // west > east ⇒ wrapped window
  });
});

describe("sparkPoints", () => {
  const at = (values: (number | null)[]) =>
    values.map((v, i) => ({ t: new Date(Date.UTC(2026, 0, 1, i)).toISOString(), value: v }));

  it("maps values into the chart box, y inverted", () => {
    const spark = sparkPoints(at([0, 10, 5]))!;
    expect(spark.pts).toHaveLength(3);
    const ys = spark.pts.map(([, y]) => y);
    expect(ys[1]).toBeLessThan(ys[0]); // max sits highest (smallest y)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });

  it("centres a flat series and rejects degenerate input", () => {
    const flat = sparkPoints(at([7, 7, 7]))!;
    const ys = flat.pts.map(([, y]) => y);
    expect(new Set(ys).size).toBe(1);
    expect(sparkPoints(at([7]))).toBeNull();
    expect(sparkPoints(at([7, null]))).toBeNull();
  });
});

describe("formatReading", () => {
  it("gives 1 decimal under 100 and integers above", () => {
    expect(formatReading(12.34)).toBe("12.3");
    expect(formatReading(1013.6)).toBe("1014");
    expect(formatReading(-0.05)).toBe("0"); // rounds to -0, printed as 0
    expect(formatReading(-3.27)).toBe("-3.3");
  });
});
