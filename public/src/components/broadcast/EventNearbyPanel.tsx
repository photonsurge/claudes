"use client";

/**
 * "Who's affected" panel for an on-air targeted event (storm / quake / aircraft
 * / ship). Given the event's [lng,lat] it shows the cities within range — a
 * featured nearest city with its Wikipedia photo + blurb (worker-cached onto the
 * City doc; see enrich:wiki), a compact list of the other nearby cities with
 * population + distance, and any live webcams near the event. Pure presentation
 * inside the scaled broadcast stage; pointer-inert.
 */
import type { City } from "../../lib/cities";
import { formatPopulation } from "../../lib/cities";
import type { Cam } from "../../lib/cams/types";
import { nearby, formatKm } from "../../lib/geo";

const CITY_RADIUS_KM = 500;
const CAM_RADIUS_KM = 400;
const MAX_CITY_ROWS = 6;
const MAX_CAMS = 3;

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

  if (!near.length && !nearCams.length) return null;

  // Feature the nearest city that actually has Wikipedia info (photo/blurb);
  // fall back to the nearest of all.
  const featured =
    near.find((n) => n.item.wikiThumb || n.item.wikiExtract)?.item ?? near[0]?.item;
  const featuredDist = near.find((n) => n.item === featured)?.distanceKm;
  const rest = near.filter((n) => n.item !== featured);
  const shownRows = rest.slice(0, MAX_CITY_ROWS);
  const moreCities = rest.length - shownRows.length;
  const shownCams = nearCams.slice(0, MAX_CAMS);
  const moreCams = nearCams.length - shownCams.length;

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
          padding: "8px 12px 6px",
        }}
      >
        ▸ NEAR THIS EVENT
      </div>

      {/* Featured city — photo + blurb. */}
      {featured ? (
        <div style={{ padding: "0 12px 10px" }}>
          {featured.wikiThumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={featured.wikiThumb}
              alt={featured.name}
              style={{
                width: "100%",
                height: 120,
                objectFit: "cover",
                borderRadius: 6,
                display: "block",
                marginBottom: 7,
              }}
            />
          ) : null}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{featured.name}</span>
            {featuredDist != null ? (
              <span style={{ fontSize: 11, fontWeight: 700, color }}>{formatKm(featuredDist)}</span>
            ) : null}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#aebfd6", marginTop: 1 }}>
            {[featured.country, formatPopulation(featured.population), featured.isCapital ? "capital" : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {featured.wikiExtract ? (
            <div
              style={{
                fontSize: 11,
                lineHeight: 1.45,
                color: "#cdd9ec",
                marginTop: 5,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {featured.wikiExtract}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Other nearby cities. */}
      {shownRows.length ? (
        <div style={{ borderTop: "1px solid rgba(120,140,170,0.14)", padding: "6px 12px 8px" }}>
          {shownRows.map((n) => (
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
              <span style={{ fontWeight: 700, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {n.item.name}
              </span>
              <span style={{ color: "#8ea3bf", whiteSpace: "nowrap" }}>
                {[formatPopulation(n.item.population), formatKm(n.distanceKm)].filter(Boolean).join(" · ")}
              </span>
            </div>
          ))}
          {moreCities > 0 ? (
            <div style={{ fontSize: 10, color: "#7d8da5", marginTop: 3, opacity: 0.75 }}>
              +{moreCities} more within {CITY_RADIUS_KM} km
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Nearby webcams. */}
      {shownCams.length ? (
        <div style={{ borderTop: "1px solid rgba(120,140,170,0.14)", padding: "7px 12px 10px" }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: "#9fb3cc", marginBottom: 6 }}>
            ▸ LIVE WEBCAMS
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {shownCams.map((n) => (
              <div key={n.item.camId} style={{ flex: 1, minWidth: 0 }}>
                {n.item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={n.item.imageUrl}
                    alt={n.item.title}
                    style={{ width: "100%", height: 52, objectFit: "cover", borderRadius: 4, display: "block" }}
                  />
                ) : (
                  <div style={{ width: "100%", height: 52, borderRadius: 4, background: "#141b28" }} />
                )}
                <div style={{ fontSize: 9, color: "#aebfd6", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {n.item.title}
                </div>
                <div style={{ fontSize: 9, color: "#7d8da5" }}>{formatKm(n.distanceKm)}</div>
              </div>
            ))}
          </div>
          {moreCams > 0 ? (
            <div style={{ fontSize: 10, color: "#7d8da5", marginTop: 4, opacity: 0.75 }}>
              +{moreCams} more within {CAM_RADIUS_KM} km
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
