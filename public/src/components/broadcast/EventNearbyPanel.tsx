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
import { FeaturedCityClimate, CityTempSpark } from "./CityHistory";
import BroadcastCard, { CardSection } from "./BroadcastCard";

const CITY_RADIUS_KM = 500;
const CAM_RADIUS_KM = 400;
const MAX_CITY_ROWS = 6;
const MAX_CAMS = 3;
/** Seconds the featured city holds before the slide advances to the next. */
const FEATURED_HOLD_MS = 7000;

/**
 * One "other nearby city" row: name/pop/distance text plus the city's own small
 * past-year temperature sparkline (CityTempSpark — self-omits to a text-only row
 * when nothing is cached within range for that city).
 */
function NearbyCityRow({ city, distanceKm }: { city: City; distanceKm: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "3px 0" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {city.name}
        </div>
        <div style={{ color: "#8ea3bf", whiteSpace: "nowrap" }}>
          {[formatPopulation(city.population), formatKm(distanceKm)].filter(Boolean).join(" · ")}
        </div>
      </div>
      <CityTempSpark city={city} />
    </div>
  );
}

const cityPoint = (c: City): [number, number] => [c.lng, c.lat];
const camPoint = (c: Cam): [number, number] | null =>
  Number.isFinite(c.lng) && Number.isFinite(c.lat) ? [c.lng, c.lat] : null;

/**
 * Whether the "near this event" page carries enough to be worth a slide. The
 * close cities themselves now air on the TOP CITIES / CITY CONDITIONS pages
 * (bbox-scoped, from the full city DB), so this page earns its slot only for its
 * unique content: nearby webcams, OR a nearby city rich enough (photo/blurb, or
 * more than one) that it won't render as a bare name over empty space — the
 * "sparse single city" look this used to fall into over data-thin regions.
 */
export function eventNearbySlideHasContent(center: [number, number], cities: City[], cams: Cam[]): boolean {
  if (nearby(cams, center, camPoint, CAM_RADIUS_KM).length) return true;
  const near = nearby(
    cities.filter((c) => (c.population ?? 0) > 0 || c.isCapital),
    center,
    cityPoint,
    CITY_RADIUS_KM,
  );
  if (near.length >= 2) return true;
  return near.some((n) => n.item.wikiThumb != null || n.item.wikiExtract != null);
}

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

  if (!near.length && !nearCams.length) return null;

  const rest = near.filter((n) => n.item !== featured);
  const shownRows = rest.slice(0, MAX_CITY_ROWS);
  const moreCities = rest.length - shownRows.length;
  const shownCams = nearCams.slice(0, MAX_CAMS);
  const moreCams = nearCams.length - shownCams.length;

  return (
    <BroadcastCard accent={color} eyebrow="Near This Event">
      {/* Featured city — photo + blurb; slot cycles through every nearby city. */}
      {featured ? (
        <div>
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

      {/* Featured city's past-year climate — temp / humidity / rain, keyed to
          this city (FeaturedCityClimate, shared with the top-cities slide). */}
      {featured ? <FeaturedCityClimate name={featured.name} center={[featured.lng, featured.lat]} /> : null}

      {/* Other nearby cities — name/pop/distance plus each city's own past-year
          temperature sparkline (NearbyCityRow), fetched per row. */}
      {shownRows.length ? (
        <CardSection style={{ fontSize: 13 }}>
          {shownRows.map((n) => (
            <NearbyCityRow key={n.item.id} city={n.item} distanceKm={n.distanceKm} />
          ))}
          {moreCities > 0 ? (
            <div style={{ fontSize: 11, color: "#7d8da5", marginTop: 4, opacity: 0.75 }}>
              +{moreCities} more within {CITY_RADIUS_KM} km
            </div>
          ) : null}
        </CardSection>
      ) : null}

      {/* Nearby webcams. */}
      {shownCams.length ? (
        <CardSection eyebrow="Live Webcams">
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
        </CardSection>
      ) : null}
    </BroadcastCard>
  );
}
