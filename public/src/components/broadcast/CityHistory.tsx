"use client";

/**
 * Shared per-city history bits for the broadcast cards that feature a city and
 * want to talk about its climate: the "near this event" panel and the country /
 * region "top cities" slide. Both used to spell these out inline; folded here so
 * there's one implementation of each.
 *
 *  - <FeaturedCityClimate> — the featured city's "PAST YEAR" strip (temp /
 *    humidity / rain), the same charts PointHistoryPanel draws for the on-air
 *    focus, just keyed to a city point instead of the camera centre.
 *  - <CityTempSpark> — a tiny past-year temperature sparkline + latest reading,
 *    small enough to sit at the right edge of a city list row.
 *
 * Both self-hide (return null) when nothing is cached within range for the city,
 * so a row/strip simply reads as text-only rather than leaving an empty chart.
 */
import type { City } from "../../lib/cities";
import { useClimateYear } from "../../lib/history-client";
import { buildClimateRows, sparkPoints, toPath, CHART_W, formatReading, type SparkPoint } from "./PointHistoryPanel";
import { CardSection, CardEyebrow } from "./BroadcastCard";

/** Inline per-row sparkline size — small enough to sit beside a row's
 *  population/distance text. Rendered width is much narrower than `CHART_W`
 *  (the viewBox), so the SVG scale itself thins the trace — bump strokeWidth up
 *  front to compensate so it still reads clearly on video output. */
const ROW_SPARK_W = 64;
const ROW_SPARK_H = 24;
const ROW_SPARK_STROKE = 9;
/** Past-year charts sit three-in-a-row (temp / humidity / rain) rather than
 *  stacked, so each is drawn shorter than the full-size PointHistoryPanel chart
 *  (CHART_H = 108) and squeezes into a third of the card width. */
export const CLIMATE_CHART_H = 58;

/**
 * One past-year cell in the 3-across climate strip: a short label, the latest
 * reading, and a compact sparkline. Its own SVG (rather than reusing MiniChart)
 * because MiniChart's header is sized for a full-width single chart, which
 * overflows a ~third-width column. The trace is drawn on the shared `CHART_W`
 * viewBox with `preserveAspectRatio: none`, so a chunkier stroke keeps it
 * readable once the width is compressed into a narrow column.
 */
function ClimateCell({
  label,
  color,
  units,
  points,
  caption,
  height,
}: {
  label: string;
  color: string;
  units: string;
  points: SparkPoint[];
  caption: string;
  height: number;
}) {
  const spark = sparkPoints(points, height);
  if (!spark) return null;
  const first = spark.pts[0];
  const last = spark.pts[spark.pts.length - 1];
  const latest = [...points].reverse().find((p) => p.value != null)?.value ?? null;
  const area = `${toPath(spark.pts)} L${last[0]},${height} L${first[0]},${height} Z`;

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 0.6,
          color: "#aebdd2",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <span style={{ color, marginRight: 3 }}>▮</span>
        {label}
      </span>
      <span style={{ fontSize: 16, fontWeight: 850, color: "#f3f7ff", whiteSpace: "nowrap" }}>
        {latest != null ? formatReading(latest) : "—"}
        <span style={{ fontSize: 9, fontWeight: 700, color: "#9db0ca", marginLeft: 2 }}>{units}</span>
      </span>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${CHART_W} ${height}`}
        preserveAspectRatio="none"
        style={{ display: "block", borderRadius: 5, background: "rgba(4,10,20,0.78)" }}
      >
        <path d={area} fill={color} opacity={0.18} />
        <path d={toPath(spark.pts)} fill="none" stroke={color} strokeWidth={4.5} strokeLinejoin="round" strokeLinecap="round" />
        {last ? <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke="#040a14" strokeWidth={2} /> : null}
      </svg>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3, color: "#91a1b9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {caption}
      </span>
    </div>
  );
}

/** Long chart labels ("TEMP · YEAR") don't fit a third-width column — the "Past
 *  Year" is already stated by the strip eyebrow, so keep just the variable. */
const shortLabel = (label: string) => label.split("·")[0].trim();

/**
 * The featured city's past-year climate — temp / humidity / rain, three in a
 * row. Own `useClimateYear` call keyed to the city point; cheap since the
 * climate route is a worker-cached Mongo nearest-lookup, not a live upstream call.
 */
export function FeaturedCityClimate({
  name,
  center,
  height = CLIMATE_CHART_H,
}: {
  name: string;
  center: [number, number];
  height?: number;
}) {
  const climate = useClimateYear(center, "monthly");
  const rows = buildClimateRows(climate.datasets);
  if (!rows.length) return null;

  return (
    <CardSection style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <CardEyebrow>{name.toUpperCase()} · Past Year</CardEyebrow>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        {rows.map((row) => (
          <ClimateCell
            key={row.variable}
            label={shortLabel(row.label)}
            color={row.color}
            units={row.units}
            points={row.points}
            caption={row.caption}
            height={height}
          />
        ))}
      </div>
    </CardSection>
  );
}

/**
 * A tiny past-year temperature sparkline + its latest reading, for the right
 * edge of a city list row. Fetched independently per row (own `useClimateYear`)
 * since each city sits at its own point. Returns null (text-only row) when
 * nothing is cached within range.
 */
export function CityTempSpark({ city }: { city: City }) {
  const climate = useClimateYear([city.lng, city.lat], "monthly");
  const tempRow = buildClimateRows(climate.datasets).find((r) => r.variable === "temp");
  const spark = tempRow ? sparkPoints(tempRow.points, ROW_SPARK_H) : null;
  if (!tempRow || !spark) return null;
  const latest = [...tempRow.points].reverse().find((p) => p.value != null)?.value ?? null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      {latest != null ? (
        <span style={{ fontSize: 12, fontWeight: 800, color: tempRow.color }}>{formatReading(latest)}°</span>
      ) : null}
      <svg width={ROW_SPARK_W} height={ROW_SPARK_H} viewBox={`0 0 ${CHART_W} ${ROW_SPARK_H}`} preserveAspectRatio="none">
        <path
          d={toPath(spark.pts)}
          fill="none"
          stroke={tempRow.color}
          strokeWidth={ROW_SPARK_STROKE}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
