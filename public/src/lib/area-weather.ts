/**
 * Turn a place's area-weather snapshot history (Country or Region) into the
 * per-variable spark-chart series the detail pages plot with `MiniChart`.
 * The repo returns snapshots newest-first; charts read oldest→newest, so we
 * reverse. Purely presentational — no fetching here.
 */
import type { iAreaWeatherReportModel } from "@photonsurge/shared/db/area-weather-report-model";
import type { SparkPoint } from "../components/broadcast/PointHistoryPanel";

/** Draw order + display label for the area-weather variables. */
export const AREA_VAR_LABEL: Record<string, string> = {
  temp: "TEMPERATURE",
  humidity: "HUMIDITY",
  wind: "WIND",
  gust: "GUSTS",
  rain: "RAIN RATE",
  storm: "CAPE",
  pressure: "PRESSURE",
  cloud: "CLOUD COVER",
  snow: "SNOW DEPTH",
  sst: "SEA TEMP",
  current: "CURRENT",
  salinity: "SALINITY",
  wave: "WAVE HEIGHT",
  radar: "RADAR",
};

export const AREA_VAR_COLOR: Record<string, string> = {
  temp: "#e66767",
  humidity: "#199e70",
  wind: "#9085e9",
  gust: "#d55181",
  rain: "#3987e5",
  storm: "#d95926",
  pressure: "#c98500",
  cloud: "#008300",
  snow: "#3987e5",
  sst: "#199e70",
  current: "#9085e9",
  salinity: "#d55181",
  wave: "#3987e5",
  radar: "#d95926",
};

export interface AreaWeatherSeries {
  variable: string;
  label: string;
  color: string;
  units: string;
  points: SparkPoint[];
  avg: number | null;
  caption: string;
}

function fmt(v: number): string {
  const abs = Math.abs(v);
  return abs >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}

/**
 * One chart series per variable that appears in the history. Points carry each
 * snapshot's `mean`; the caption summarises avg-of-means / min-of-mins /
 * max-of-maxes across the window.
 */
export function areaWeatherSeries(history: iAreaWeatherReportModel[]): AreaWeatherSeries[] {
  const ordered = [...history].sort(
    (a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime(),
  );
  const byVar = new Map<string, AreaWeatherSeries>();

  for (const report of ordered) {
    const t = new Date(report.generatedAt).toISOString();
    for (const stat of report.stats) {
      let series = byVar.get(stat.variable);
      if (!series) {
        series = {
          variable: stat.variable,
          label: AREA_VAR_LABEL[stat.variable] ?? stat.variable.toUpperCase(),
          color: AREA_VAR_COLOR[stat.variable] ?? "#3987e5",
          units: stat.units,
          points: [],
          avg: null,
          caption: "",
        };
        byVar.set(stat.variable, series);
      }
      series.points.push({ t, value: stat.mean });
    }
  }

  return [...byVar.values()].map((series) => {
    const values = series.points.map((p) => p.value).filter((v): v is number => v != null);
    if (values.length) {
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      series.avg = avg;
      series.caption = `avg ${fmt(avg)} · min ${fmt(Math.min(...values))} · max ${fmt(Math.max(...values))} · ${values.length} pts`;
    }
    return series;
  });
}
