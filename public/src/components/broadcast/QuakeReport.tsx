"use client";

/**
 * Seismic breakdown for an on-air / selected earthquake: the magnitude and depth
 * classified into their descriptor bands (with a one-line "what this means"
 * blurb, from the shared seismic reference), plus the nearest notable cities with
 * their distance + compass bearing to the epicentre. Pure presentation — takes
 * the raw numbers off the segment and the loaded city list; no network. Reused on
 * the scaled broadcast stage and on the operator console (same look in both).
 */
import {
  quakeMagnitudeLabel,
  quakeMagnitudeBlurb,
  quakeDepthLabel,
  quakeDepthBlurb,
  quakeDepthClass,
} from "@photonsurge/shared/seismic";
import type { City } from "../../lib/cities";
import { formatPopulation } from "../../lib/cities";
import { nearby, formatKm, bearingLabel } from "../../lib/geo";

/** Notable-only floor so ocean/remote quakes still name recognisable places. */
const MIN_CITY_POP = 50_000;
const MAX_CITIES = 10;
/** Half Earth's circumference — an effectively unbounded "nearest N" radius. */
const ALL_KM = 20_100;

/** Magnitude → chip colour (green minor → red major/great). */
function magColor(mag: number): string {
  if (mag >= 7) return "#ef4444";
  if (mag >= 6) return "#f97316";
  if (mag >= 5) return "#eab308";
  if (mag >= 4) return "#84cc16";
  return "#22c55e";
}

/** Depth class → chip colour (mirrors the epicentre-ring tint on the globe). */
const DEPTH_COLOR: Record<ReturnType<typeof quakeDepthClass>, string> = {
  shallow: "#ef4444",
  intermediate: "#f97316",
  deep: "#3b82f6",
};

const cityPoint = (c: City): [number, number] => [c.lng, c.lat];

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: 1,
        textTransform: "uppercase",
        padding: "2px 6px",
        borderRadius: 4,
        color: "#0a0e16",
        background: color,
      }}
    >
      {text}
    </span>
  );
}

function Reading({
  label,
  value,
  chip,
  chipColor,
  blurb,
}: {
  label: string;
  value: string;
  chip: string;
  chipColor: string;
  blurb: string;
}) {
  return (
    <div style={{ padding: "8px 12px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: "#9fb3cc", width: 62 }}>
          {label}
        </span>
        <span style={{ fontSize: 17, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
          {value}
        </span>
        <Chip text={chip} color={chipColor} />
      </div>
      <div style={{ fontSize: 10.5, lineHeight: 1.4, color: "#aebfd6", marginTop: 3 }}>{blurb}</div>
    </div>
  );
}

export default function QuakeReport({
  mag,
  depthKm,
  center,
  cities,
  color = "#e08a1e",
}: {
  mag: number;
  depthKm: number;
  /** Epicentre [lng, lat]. */
  center: [number, number];
  cities: City[];
  color?: string;
}) {
  const near = nearby(
    cities.filter((c) => (c.population ?? 0) >= MIN_CITY_POP || c.isCapital),
    center,
    cityPoint,
    ALL_KM,
  ).slice(0, MAX_CITIES);

  return (
    <div
      style={{
        width: 320,
        background: "rgba(8,13,22,0.82)",
        border: `1px solid ${color}44`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        fontFamily: "system-ui, sans-serif",
        color: "#e6eefb",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: "#9fb3cc",
          padding: "8px 12px 4px",
        }}
      >
        ▸ SEISMIC REPORT
      </div>

      <Reading
        label="MAGNITUDE"
        value={`M${mag.toFixed(1)}`}
        chip={quakeMagnitudeLabel(mag)}
        chipColor={magColor(mag)}
        blurb={quakeMagnitudeBlurb(mag)}
      />
      <Reading
        label="DEPTH"
        value={`${Math.round(depthKm)} km`}
        chip={quakeDepthLabel(depthKm)}
        chipColor={DEPTH_COLOR[quakeDepthClass(depthKm)]}
        blurb={quakeDepthBlurb(depthKm)}
      />

      {near.length ? (
        <div style={{ borderTop: "1px solid rgba(120,140,170,0.14)", padding: "7px 12px 9px" }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: "#9fb3cc", marginBottom: 5 }}>
            ▸ NEAREST CITIES
          </div>
          {near.map((n) => (
            <div
              key={n.item.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 8,
                fontSize: 11,
                padding: "2px 0",
              }}
            >
              <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <span style={{ fontWeight: 700, color: "#e6eefb" }}>{n.item.name}</span>
                {n.item.cc ? <span style={{ color: "#7d8da5" }}>{` ${n.item.cc}`}</span> : null}
                {n.item.population ? (
                  <span style={{ color: "#7d8da5" }}>{` · ${formatPopulation(n.item.population)}`}</span>
                ) : null}
              </span>
              <span style={{ color: "#8ea3bf", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {formatKm(n.distanceKm)} {bearingLabel(cityPoint(n.item), center)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
