"use client";

/**
 * "Who's affected" pages for an on-air targeted event (storm / quake / aircraft
 * / ship). Given the event's [lng,lat] these cover the cities within range:
 * ONE FULL DECK SLIDE PER NEARBY CITY (photo + Wikipedia blurb when the City doc
 * has one, worker-cached; see enrich:wiki, plus a "PAST YEAR" climate strip for
 * that same city — the same chart PointHistoryPanel draws, keyed to the city),
 * followed by an overview page listing the rest with population + distance and
 * any live webcams near the event.
 *
 * The per-city pages used to be a "featured slot" INSIDE the overview card,
 * swapping every 7 seconds while the deck was still scrolling that card's body —
 * a slide show inside a slide, changing under the viewer mid-read. A card holds
 * still for as long as it is on air; the deck turns the page (see SlideDeck /
 * run-pacing). Pure presentation inside the scaled broadcast stage;
 * pointer-inert.
 */
import type { City } from "../../lib/cities";
import { formatPopulation } from "../../lib/cities";
import type { Cam } from "../../lib/cams/types";
import { nearby, formatKm, type Nearby } from "../../lib/geo";
import { isNotableCity, nearbyCities } from "../../lib/broadcast";
import { FeaturedCityClimate, CityTempSpark } from "./CityHistory";
import BroadcastCard, { CardSection } from "./BroadcastCard";

const CITY_RADIUS_KM = 500;
const CAM_RADIUS_KM = 400;
const MAX_CITY_ROWS = 6;
const MAX_CAMS = 3;

/**
 * One "nearby city" row: name/pop/distance text plus the city's own small
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

const camPoint = (c: Cam): [number, number] | null =>
  Number.isFinite(c.lng) && Number.isFinite(c.lat) ? [c.lng, c.lat] : null;

/** The cities near the event, nearest first — with a real population (or
 *  capitals) so tiny unnamed places don't crowd out the notable ones. */
export function eventNearbyEntries(center: [number, number], cities: City[]): Nearby<City>[] {
  return nearbyCities(cities, center, CITY_RADIUS_KM, isNotableCity);
}

/**
 * The nearby cities that earn a slide OF THEIR OWN: the ones carrying a photo or
 * a blurb. Without either, a city page is a bare name over empty space — the
 * "sparse single city" look this card used to fall into over data-thin regions —
 * so those stay rows on the overview page instead.
 */
export function eventNearbyCityPages(center: [number, number], cities: City[]): Nearby<City>[] {
  return eventNearbyEntries(center, cities).filter(
    (n) => n.item.wikiThumb != null || n.item.wikiPhoto != null || n.item.wikiExtract != null,
  );
}

/**
 * Whether the OVERVIEW page is worth a slide. The close cities themselves now
 * air on their own pages (above) and on the bbox-scoped TOP CITIES pages, so
 * this list earns its slot only when it has webcams to show, or enough cities
 * that the list says something a single page didn't.
 */
export function eventNearbySlideHasContent(center: [number, number], cities: City[], cams: Cam[]): boolean {
  if (nearby(cams, center, camPoint, CAM_RADIUS_KM).length) return true;
  return eventNearbyEntries(center, cities).length >= 2;
}

/** A stable, id-safe instance key for one nearby city's slide. */
export function nearbyCitySlideKey(city: City): string {
  return String(city.id ?? `${city.lng},${city.lat}`).replace(/:/g, "-");
}

/**
 * ONE nearby city, one slide: the establishing photo, the name and how far it
 * sits from the event, the blurb in full (the deck scrolls the body, so it is no
 * longer clamped) and that city's past-year climate.
 */
export function EventNearbyCityPanel({
  city,
  distanceKm,
  color = "#38bdf8",
}: {
  city: City;
  distanceKm: number;
  color?: string;
}) {
  return (
    <BroadcastCard accent={color} eyebrow="Near This Event">
      {city.wikiThumb || city.wikiPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={city.wikiThumb || city.wikiPhoto}
          alt={city.name}
          style={{ width: "100%", height: 175, objectFit: "cover", borderRadius: 7, display: "block", marginBottom: 9 }}
        />
      ) : null}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 24.2, fontWeight: 800, color: "#fff" }}>{city.name}</span>
        <span style={{ fontSize: 15.4, fontWeight: 700, color }}>{formatKm(distanceKm)}</span>
      </div>
      <div style={{ fontSize: 15.4, fontWeight: 600, color: "#aebfd6", marginTop: 2 }}>
        {[city.country, formatPopulation(city.population), city.isCapital ? "capital" : null]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {city.wikiExtract ? (
        <div style={{ fontSize: 14.3, lineHeight: 1.5, color: "#cdd9ec", marginTop: 7 }}>{city.wikiExtract}</div>
      ) : null}

      {/* This city's past-year climate — temp / humidity / rain. */}
      <FeaturedCityClimate name={city.name} center={[city.lng, city.lat]} />
    </BroadcastCard>
  );
}

/** The overview page: the cities near the event, then any live webcams. */
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
  const near = eventNearbyEntries(center, cities);
  const nearCams = nearby(cams, center, camPoint, CAM_RADIUS_KM);

  if (!near.length && !nearCams.length) return null;

  const shownRows = near.slice(0, MAX_CITY_ROWS);
  const moreCities = near.length - shownRows.length;
  const shownCams = nearCams.slice(0, MAX_CAMS);
  const moreCams = nearCams.length - shownCams.length;

  return (
    <BroadcastCard accent={color} eyebrow="Near This Event">
      {/* Cities near the event — name/pop/distance plus each city's own past-year
          temperature sparkline (NearbyCityRow), fetched per row. */}
      {shownRows.length ? (
        <CardSection first eyebrow={`Closest Towns & Cities · within ${CITY_RADIUS_KM} km`} style={{ fontSize: 14.3 }}>
          {shownRows.map((n) => (
            <NearbyCityRow key={n.item.id} city={n.item} distanceKm={n.distanceKm} />
          ))}
          {moreCities > 0 ? (
            <div style={{ fontSize: 12.1, color: "#7d8da5", marginTop: 4, opacity: 0.75 }}>
              +{moreCities} more within {CITY_RADIUS_KM} km
            </div>
          ) : null}
        </CardSection>
      ) : null}

      {/* Nearby webcams. */}
      {shownCams.length ? (
        <CardSection eyebrow="Live Webcams" first={!shownRows.length}>
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
                <div style={{ fontSize: 12.1, color: "#aebfd6", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {n.item.title}
                </div>
                <div style={{ fontSize: 12.1, color: "#7d8da5" }}>{formatKm(n.distanceKm)}</div>
              </div>
            ))}
          </div>
          {moreCams > 0 ? (
            <div style={{ fontSize: 12.1, color: "#7d8da5", marginTop: 5, opacity: 0.75 }}>
              +{moreCams} more within {CAM_RADIUS_KM} km
            </div>
          ) : null}
        </CardSection>
      ) : null}
    </BroadcastCard>
  );
}
