"use client";

/**
 * "POINT HISTORY" / "AREA HISTORY" — small-multiple trend charts of every
 * archived dataset at the on-air focus, drawn from the long-term WeatherFrame
 * archive (/api/weather/history/point, or /area over the framed bbox on wide
 * shots), plus a "PAST YEAR" section of monthly ERA5 climate (temperature,
 * humidity, rain via /api/weather/history/climate) so the director can talk
 * about the last twelve months, not just the last 72 hours.
 *
 * One chart per variable (never two scales on one axis): a 2px line with a
 * soft area fill, a dashed average line, a dot on the latest reading, and an
 * avg/min/max caption. Colors come from a CVD/contrast-validated dark
 * categorical palette; identity is carried by each chart's title, so text
 * stays in ink tokens, never the series hue. Pure presentation inside the
 * scaled broadcast stage; pointer-inert (video output — no hover layer).
 * Self-hiding while the archive and climate source are both empty.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { HISTORY_WINDOW_HOURS, type ClimateBucketedDataset } from "../../lib/history-client";
import { usePointHistorySeries, useAreaHistorySeries, useClimateFor } from "../../lib/focus/focus-client";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard from "./BroadcastCard";

/** Compact side-note (EventOverlay) paging: how many charts show at once before
 *  advancing — one at a time there, since the side-note is too narrow to tile.
 *  The full bottom-left card instead tiles EVERY variable at once (see the
 *  `tiled` path in the component) rather than slideshowing one-per-page. */
const CHARTS_PER_SLIDE = 1;
/** How long each slide holds before advancing to the next (compact paging). */
const SLIDE_HOLD_MS = 6000;

/**
 * Paginates a section's charts into fixed-size slides and auto-advances on a
 * timer, so a section with many variables (a mixed land/sea area bbox can
 * easily have a dozen) reads as a slideshow instead of one long scroll.
 * Exported so other broadcast cards with the same "one at a time" need (e.g.
 * EventNearbyPanel's featured-city climate strip) can reuse the same timer
 * instead of stacking every chart at once.
 */
export function usePagedSlides<T>(items: T[], perPage: number): { visible: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (pageCount <= 1) return;
    const iv = setInterval(() => setIdx((n) => n + 1), SLIDE_HOLD_MS);
    return () => clearInterval(iv);
  }, [pageCount]);

  const page = idx % pageCount;
  return { visible: items.slice(page * perPage, page * perPage + perPage), page, pageCount };
}

/** Validated dark-surface categorical palette (see dataviz palette check). */
const VARIABLE_COLOR: Record<string, string> = {
  temp: "#e66767",
  humidity: "#199e70",
  wind: "#9085e9",
  gust: "#d55181",
  rain: "#3987e5",
  storm: "#d95926",
  pressure: "#c98500",
  cloud: "#008300",
  // Re-used hues below are fine: every chart is its own labeled panel, so
  // color never has to distinguish two series inside one plot.
  snow: "#3987e5",
  sst: "#199e70",
  current: "#9085e9",
  salinity: "#d55181",
  wave: "#3987e5",
  radar: "#d95926",
};
const FALLBACK_COLOR = "#3987e5";

const VARIABLE_LABEL: Record<string, string> = {
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

/** Outer card width — matches the other bottom-left context cards
 *  (TrackInfoPanel/QuakeReport/EventNearbyPanel) so the stacked column
 *  reads as one consistent left edge. */
const PANEL_W = 320;
const PANEL_PAD_X = 16;

/** Logical chart box inside the card. One chart shows at a time now, so it
 *  can afford to be drawn tall rather than as a thin sparkline. Exported so a
 *  compact embed can size its own (smaller, CSS-scaled) sparkline SVG against
 *  the same viewBox `sparkPoints` lays its x-coordinates out on. */
export const CHART_W = PANEL_W - 2 * PANEL_PAD_X;
const CHART_H = 108;
/** Chart height for one tile in the tiled small-multiples grid — short, since a
 *  dozen-plus variables share the fixed card at once instead of one-per-slide. */
const TILE_CHART_H = 40;
const PAD_Y = 6;

/** A plottable moment: time + the number to draw. */
export interface SparkPoint {
  t: string;
  value: number | null;
}

/** Format a reading compactly: 1 decimal under 100, integers above. */
export function formatReading(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100) return String(Math.round(v));
  return (Math.round(v * 10) / 10).toString();
}

/**
 * Scale a series into the chart box (y inverted, PAD_Y headroom). Time maps
 * linearly on x so an outage gap reads as a gap in slope, not a lie of
 * continuity. Returns null for degenerate series.
 */
export function sparkPoints(
  series: SparkPoint[],
  height: number = CHART_H,
): { pts: [number, number][]; yOf: (v: number) => number } | null {
  const vals = series.map((p) => p.value).filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length < 2) return null;
  const t0 = new Date(series[0].t).getTime();
  const t1 = new Date(series[series.length - 1].t).getTime();
  const span = Math.max(1, t1 - t0);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max - min < 1e-9) {
    // Flat series: centre the line rather than slamming it to an edge.
    min -= 0.5;
    max += 0.5;
  }
  const yOf = (v: number) => PAD_Y + (1 - (v - min) / (max - min)) * (height - 2 * PAD_Y);
  const pts: [number, number][] = [];
  for (const p of series) {
    if (p.value == null || !Number.isFinite(p.value)) continue;
    const x = ((new Date(p.t).getTime() - t0) / span) * CHART_W;
    pts.push([x, yOf(p.value)]);
  }
  return { pts, yOf };
}

/** Exported so a compact embed (e.g. EventNearbyPanel's per-city sparkline)
 *  can draw a trace from `sparkPoints` output without its own copy. */
export const toPath = (pts: [number, number][]) =>
  `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")}`;

/** One labeled sparkline row: title, latest reading, trace, caption. Exported
 *  so other broadcast cards (e.g. EventNearbyPanel's featured-city climate
 *  strip) can draw the exact same chart without re-implementing it. */
export function MiniChart({
  label,
  color,
  units,
  points,
  avg,
  caption,
  height = CHART_H,
  dense = false,
}: {
  label: string;
  color: string;
  units: string;
  points: SparkPoint[];
  /** Where to draw the dashed reference line (omitted when null). */
  avg: number | null;
  caption: string;
  /** Chart height in px — smaller for a compact embed (e.g. inside EventOverlay). */
  height?: number;
  /** Tile styling for the small-multiples grid: smaller type, ellipsised label +
   *  caption so every tile is a uniform, single-line-safe cell. */
  dense?: boolean;
}) {
  const spark = sparkPoints(points, height);
  if (!spark) return null;
  const last = spark.pts[spark.pts.length - 1];
  const latestVal = [...points].reverse().find((p) => p.value != null)?.value ?? null;
  const first = spark.pts[0];
  const area = `${toPath(spark.pts)} L${last[0]},${height} L${first[0]},${height} Z`;
  const ellipsis: CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: dense ? 2 : 4, width: "100%", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: dense ? 8 : 12 }}>
        <span style={{ fontSize: dense ? 10 : 13, fontWeight: 800, letterSpacing: dense ? 0.8 : 1.2, color: "#aebdd2", ...ellipsis }}>
          <span style={{ color, marginRight: dense ? 4 : 6 }}>▮</span>
          {label}
        </span>
        <span style={{ fontSize: dense ? 15 : 20, fontWeight: 850, color: "#f3f7ff", whiteSpace: "nowrap", flexShrink: 0 }}>
          {latestVal != null ? formatReading(latestVal) : "—"}
          <span style={{ fontSize: dense ? 9 : 12, fontWeight: 700, color: "#9db0ca", marginLeft: dense ? 3 : 4 }}>{units}</span>
        </span>
      </div>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${CHART_W} ${height}`}
        preserveAspectRatio="none"
        style={{ display: "block", borderRadius: 6, background: "rgba(4,10,20,0.78)" }}
      >
        <path d={area} fill={color} opacity={0.18} />
        {avg != null ? (
          <line
            x1={0}
            y1={spark.yOf(avg)}
            x2={CHART_W}
            y2={spark.yOf(avg)}
            stroke="#9fb0c8"
            strokeWidth={1.2}
            strokeDasharray="5 5"
            opacity={0.55}
          />
        ) : null}
        <path d={toPath(spark.pts)} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {last ? <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke="#040a14" strokeWidth={1.5} /> : null}
      </svg>
      <div style={{ fontSize: dense ? 9 : 10.5, fontWeight: 700, letterSpacing: 0.5, color: "#91a1b9", ...ellipsis }}>{caption}</div>
    </div>
  );
}

/** Section header row inside the card. Exported so other broadcast cards
 *  (e.g. ForecastPanel) share the same title/tag/page-counter styling. */
export function SectionTitle({
  title,
  tag,
  accent,
  page,
  pageCount,
}: {
  title: string;
  tag: string;
  accent: string;
  /** Current/total slide, when the section has more than one page. */
  page?: number;
  pageCount?: number;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 12, fontWeight: 850, letterSpacing: 1.5, color: "#eef4ff" }}>{title}</span>
      <span style={{ fontSize: 9, fontWeight: 750, letterSpacing: 1.05, color: accent }}>
        {tag}
        {pageCount != null && pageCount > 1 ? ` · ${(page ?? 0) + 1}/${pageCount}` : ""}
      </span>
    </div>
  );
}

/** Month key "2026-03" → a parseable date for the x-axis; weekly keys pass through. */
const bucketTime = (key: string) => (key.length === 7 ? `${key}-01` : key);

/** The past-year charts the director cares about, in a fixed order. */
const CLIMATE_ROWS: Array<{
  variable: ClimateBucketedDataset["variable"];
  label: string;
  color: string;
  caption: (d: ClimateBucketedDataset, all: ClimateBucketedDataset[]) => string;
}> = [
  {
    variable: "temp",
    label: "TEMP · YEAR",
    color: VARIABLE_COLOR.temp,
    caption: (d, all) => {
      const hi = all.find((x) => x.variable === "tempMax");
      const lo = all.find((x) => x.variable === "tempMin");
      const yrHi = hi?.buckets.length ? Math.max(...hi.buckets.map((b) => b.max)) : null;
      const yrLo = lo?.buckets.length ? Math.min(...lo.buckets.map((b) => b.min)) : null;
      return yrHi != null && yrLo != null
        ? `yr hi ${formatReading(yrHi)} · lo ${formatReading(yrLo)}`
        : `avg ${formatReading(avgOf(d))}`;
    },
  },
  {
    variable: "humidity",
    label: "HUMIDITY · YEAR",
    color: VARIABLE_COLOR.humidity,
    caption: (d) => `avg ${formatReading(avgOf(d))}`,
  },
  {
    variable: "rain",
    label: "RAIN · YEAR",
    color: VARIABLE_COLOR.rain,
    caption: (d) => `total ${formatReading(d.buckets.reduce((a, b) => a + b.sum, 0))} mm`,
  },
];

const avgOf = (d: ClimateBucketedDataset) =>
  d.buckets.reduce((a, b) => a + b.value, 0) / Math.max(1, d.buckets.length);

/** Turn a point's raw climate datasets into the "PAST YEAR" chart rows (temp/
 *  humidity/rain, fixed order, skipping any variable with too little data) —
 *  exported so a second, smaller card (EventNearbyPanel's featured city) can
 *  show the same past-year charts without duplicating this mapping. */
export function buildClimateRows(datasets: ClimateBucketedDataset[]): Array<{
  variable: ClimateBucketedDataset["variable"];
  label: string;
  color: string;
  units: string;
  points: SparkPoint[];
  avg: number;
  caption: string;
}> {
  return CLIMATE_ROWS.map((row) => {
    const d = datasets.find((x) => x.variable === row.variable);
    if (!d || d.buckets.length < 2) return null;
    return {
      variable: row.variable,
      label: row.label,
      color: row.color,
      units: d.units,
      points: d.buckets.map((b) => ({ t: bucketTime(b.key), value: b.value })),
      avg: avgOf(d),
      caption: row.caption(d, datasets),
    };
  }).filter((r): r is NonNullable<typeof r> => r != null);
}

/** Compact sizing for the embedded-in-EventOverlay variant — narrower panel,
 *  shorter charts, tighter padding, so it reads as a small side note rather
 *  than the full bottom-left card. */
const COMPACT_PANEL_W = 220;
const COMPACT_CHART_H = 56;

export default function PointHistoryPanel({
  center,
  bbox = null,
  theme = DEFAULT_THEME,
  compact = false,
}: {
  /** Focus point [lng, lat] — the on-air segment's centre (or camera fallback). */
  center: [number, number] | null;
  /** The framed area on wide shots — switches the live section to area stats. */
  bbox?: [number, number, number, number] | null;
  theme?: BroadcastTheme;
  /** Small side-note sizing for embedding inside EventOverlay (see kinds.ts
   *  isTargetedEvent) instead of the full bottom-left card. */
  compact?: boolean;
}) {
  // Full bottom-left card: tile every variable at once as a small-multiples
  // grid. Only the compact EventOverlay side-note keeps the one-at-a-time
  // slideshow — it's too narrow to tile.
  const tiled = !compact;
  const panelW = compact ? COMPACT_PANEL_W : PANEL_W;
  const chartH = compact ? COMPACT_CHART_H : TILE_CHART_H;
  const panelPadX = compact ? 12 : PANEL_PAD_X;
  const point = usePointHistorySeries(center, bbox);
  const area = useAreaHistorySeries(bbox);
  const climate = useClimateFor(center);

  const liveCharts = bbox
    ? area.series.map((s) => ({
        variable: s.variable,
        units: s.units,
        points: s.series.map((p) => ({ t: p.t, value: p.mean })),
        avg: s.stats?.avg ?? null,
        caption:
          s.stats && s.areaMin != null && s.areaMax != null
            ? `avg ${formatReading(s.stats.avg)} · area lo ${formatReading(s.areaMin)} · hi ${formatReading(s.areaMax)}`
            : "",
      }))
    : point.series.map((s) => ({
        variable: s.variable,
        units: s.units,
        points: s.series.map((p) => ({ t: p.t, value: p.value ?? p.speed ?? null })),
        avg: s.stats?.avg ?? null,
        caption: s.stats
          ? `avg ${formatReading(s.stats.avg)} · min ${formatReading(s.stats.min)} · max ${formatReading(s.stats.max)}`
          : "",
      }));

  const climateRows = buildClimateRows(climate.datasets);

  // When tiled, one page holds every chart (perPage = item count) so the grid
  // shows them all at once with no timer and no page counter; compact mode keeps
  // CHARTS_PER_SLIDE paging. Hooks stay unconditional (rules of hooks).
  const liveSlide = usePagedSlides(liveCharts, tiled ? Math.max(1, liveCharts.length) : CHARTS_PER_SLIDE);
  const climateSlide = usePagedSlides(climateRows, tiled ? Math.max(1, climateRows.length) : CHARTS_PER_SLIDE);

  if (!liveCharts.length && !climateRows.length) return null;

  // Small-multiples layout: two wider columns keep labels, readings, and chart
  // captions legible on the full deck card. Compact side-notes remain stacked.
  const chartsWrap: CSSProperties = tiled
    ? { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 10px" }
    : { display: "flex", flexDirection: "column", gap: compact ? 8 : 10 };

  return (
    <BroadcastCard
      theme={theme}
      style={{ width: panelW, boxSizing: "border-box", padding: `${compact ? 10 : 14}px ${panelPadX}px` }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 10 }}>
      {liveCharts.length ? (
        <>
          <SectionTitle
            title={bbox ? "AREA HISTORY" : "POINT HISTORY"}
            tag={`LAST ${HISTORY_WINDOW_HOURS} H${tiled ? ` · ${liveCharts.length}` : ""}`}
            accent={theme.accent}
            page={liveSlide.page}
            pageCount={liveSlide.pageCount}
          />
          <div style={chartsWrap}>
            {liveSlide.visible.map((c) => (
              <MiniChart
                key={c.variable}
                label={VARIABLE_LABEL[c.variable] ?? c.variable.toUpperCase()}
                color={VARIABLE_COLOR[c.variable] ?? FALLBACK_COLOR}
                units={c.units}
                points={c.points}
                avg={c.avg}
                caption={c.caption}
                height={chartH}
                dense={tiled}
              />
            ))}
          </div>
        </>
      ) : null}

      {climateRows.length ? (
        <>
          <SectionTitle
            title="PAST YEAR"
            tag="MONTHLY · ERA5"
            accent={theme.accent}
            page={climateSlide.page}
            pageCount={climateSlide.pageCount}
          />
          <div style={chartsWrap}>
            {climateSlide.visible.map((row) => (
              <MiniChart
                key={row.variable}
                label={row.label}
                color={row.color}
                units={row.units}
                points={row.points}
                avg={row.avg}
                caption={row.caption}
                height={chartH}
                dense={tiled}
              />
            ))}
          </div>
        </>
      ) : null}
      </div>
    </BroadcastCard>
  );
}
