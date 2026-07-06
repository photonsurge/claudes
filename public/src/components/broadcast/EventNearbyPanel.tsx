"use client";

/**
 * "Who's affected" panel for an on-air targeted event (storm / quake / aircraft
 * / ship). Given the event's [lng,lat] it shows the cities within range — a
 * featured city slot that cycles through every nearby city (photo + Wikipedia
 * blurb when the City doc has one, worker-cached; see enrich:wiki, plus a
 * "PAST YEAR" climate strip for that same city — same chart as PointHistoryPanel,
 * just keyed to the featured city instead of the on-air camera centre), a
 * compact list of the other nearby cities with population + distance, and any
 * live webcams near the event. Pure presentation inside the scaled broadcast
 * stage; pointer-inert.
 */
import { useEffect, useState } from "react";
import type { City } from "../../lib/cities";
import { formatPopulation } from "../../lib/cities";
import type { Cam } from "../../lib/cams/types";
import { nearby, formatKm } from "../../lib/geo";
import { useClimateYear } from "../../lib/history-client";
import { MiniChart, buildClimateRows, usePagedSlides } from "./PointHistoryPanel";

const CITY_RADIUS_KM = 500;
const CAM_RADIUS_KM = 400;
const MAX_CITY_ROWS = 6;
const MAX_CAMS = 3;
/** Seconds the featured city holds before the slide advances to the next. */
const FEATURED_HOLD_MS = 7000;

const cityPoint = (c: City): [number, number] => [c.lng, c.lat];
const camPoint = (c: Cam): [number, number] | null =>
  Number.isFinite(c.lng) && Number.isFinite(c.lat) ? [c.lng, c.lat] : null;

export default function EventNearbyPanel({
  center,
  cities,
  cams,
  color = "#38bdf8",
}: {
  center: [number, number];
  cities: City[];
  cams: Cam[];
  color?: string;
}) {
  // Cities with a real population (or capitals) so tiny unnamed places don't
  // crowd out the notable ones; nearest first.
  const near = nearby(
    cities.filter((c) => (c.population ?? 0) > 0 || c.isCapital),
    center,
    cityPoint,
    CITY_RADIUS_KM,
  );
  const nearCams = nearby(cams, center, camPoint, CAM_RADIUS_KM);

  // Cycle the featured slot through every nearby city, nearest first, looping.
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (near.length <= 1) return;
    const iv = setInterval(() => setSlide((n) => n + 1), FEATURED_HOLD_MS);
    return () => clearInterval(iv);
  }, [near.length]);

  const featuredEntry = near.length ? near[slide % near.length] : undefined;
  const featured = featuredEntry?.item;
  const featuredDist = featuredEntry?.distanceKm;

  // A single cheap fetch (cached per rounded lat/lng) — safe to re-request on
  // every slide tick since it just tracks the currently-featured city. Must
  // run unconditionally (before the early return below) per rules-of-hooks.
  const featuredCenter = featured ? ([featured.lng, featured.lat] as [number, number]) : null;
  const climate = useClimateYear(featuredCenter, "monthly");
  const climateRows = buildClimateRows(climate.datasets);
  // One chart at a time (same timer-driven slideshow as PointHistoryPanel)
  // instead of stacking temp/humidity/rain all at once.
  const climateSlide = usePagedSlides(climateRows, 1);

  if (!near.length && !nearCams.length) return null;

  const rest = near.filter((n) => n.item !== featured);
  const shownRows = rest.slice(0, MAX_CITY_ROWS);
  const moreCities = rest.length - shownRows.length;
  const shownCams = nearCams.slice(0, MAX_CAMS);
  const moreCams = nearCams.length - shownCams.length;

  return (
    <div
      style={{
        width: 440,
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
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: "#9fb3cc",
          padding: "10px 16px 7px",
        }}
      >
        ▸ NEAR THIS EVENT
      </div>

      {/* Featured city — photo + blurb; slot cycles through every nearby city. */}
      {featured ? (
        <div style={{ padding: "0 16px 13px" }}>
          {featured.wikiThumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={featured.wikiThumb}
              alt={featured.name}
              style={{
                width: "100%",
                height: 175,
                objectFit: "cover",
                borderRadius: 7,
                display: "block",
                marginBottom: 9,
              }}
            />
          ) : null}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>{featured.name}</span>
            {featuredDist != null ? (
              <span style={{ fontSize: 14, fontWeight: 700, color }}>{formatKm(featuredDist)}</span>
            ) : null}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#aebfd6", marginTop: 2 }}>
            {[featured.country, formatPopulation(featured.population), featured.isCapital ? "capital" : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {featured.wikiExtract ? (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: "#cdd9ec",
                marginTop: 7,
                display: "-webkit-box",
                WebkitLineClamp: 8,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {featured.wikiExtract}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Featured city's past-year climate — same chart PointHistoryPanel
          draws for the on-air focus, keyed to this city instead. One variable
          at a time (timer-paged), not all three stacked. */}
      {climateRows.length ? (
        <div style={{ borderTop: "1px solid rgba(120,140,170,0.14)", padding: "9px 16px 4px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: "#9fb3cc" }}>
              ▸ {featured?.name.toUpperCase()} · PAST YEAR
            </span>
            {climateSlide.pageCount > 1 ? (
              <span style={{ fontSize: 9, fontWeight: 750, letterSpacing: 1.05, color }}>
                {climateSlide.page + 1}/{climateSlide.pageCount}
              </span>
            ) : null}
          </div>
          {climateSlide.visible.map((row) => (
            <MiniChart
              key={row.variable}
              label={row.label}
              color={row.color}
              units={row.units}
              points={row.points}
              avg={row.avg}
              caption={row.caption}
            />
          ))}
        </div>
      ) : null}

      {/* Other nearby cities. */}
      {shownRows.length ? (
        <div style={{ borderTop: "1px solid rgba(120,140,170,0.14)", padding: "8px 16px 10px" }}>
          {shownRows.map((n) => (
            <div
              key={n.item.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 10,
                fontSize: 13,
                padding: "3px 0",
              }}
            >
              <span style={{ fontWeight: 700, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {n.item.name}
              </span>
              <span style={{ color: "#8ea3bf", whiteSpace: "nowrap" }}>
                {[formatPopulation(n.item.population), formatKm(n.distanceKm)].filter(Boolean).join(" · ")}
              </span>
            </div>
          ))}
          {moreCities > 0 ? (
            <div style={{ fontSize: 11, color: "#7d8da5", marginTop: 4, opacity: 0.75 }}>
              +{moreCities} more within {CITY_RADIUS_KM} km
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Nearby webcams. */}
      {shownCams.length ? (
        <div style={{ borderTop: "1px solid rgba(120,140,170,0.14)", padding: "9px 16px 13px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: "#9fb3cc", marginBottom: 8 }}>
            ▸ LIVE WEBCAMS
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {shownCams.map((n) => (
              <div key={n.item.camId} style={{ flex: 1, minWidth: 0 }}>
                {n.item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={n.item.imageUrl}
                    alt={n.item.title}
                    style={{ width: "100%", height: 72, objectFit: "cover", borderRadius: 5, display: "block" }}
                  />
                ) : (
                  <div style={{ width: "100%", height: 72, borderRadius: 5, background: "#141b28" }} />
                )}
                <div style={{ fontSize: 11, color: "#aebfd6", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {n.item.title}
                </div>
                <div style={{ fontSize: 11, color: "#7d8da5" }}>{formatKm(n.distanceKm)}</div>
              </div>
            ))}
          </div>
          {moreCams > 0 ? (
            <div style={{ fontSize: 11, color: "#7d8da5", marginTop: 5, opacity: 0.75 }}>
              +{moreCams} more within {CAM_RADIUS_KM} km
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
