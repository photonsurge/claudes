"use client";

/**
 * "TOP CITIES" — the CITY GUIDE pages of an on-air country spotlight, region
 * tour or targeted event, as an overview list followed by ONE FULL DECK SLIDE
 * PER CITY (photo + Wikipedia blurb when the City doc has one, worker-cached;
 * see enrich:wiki, plus that city's own forecast for today). The caller picks
 * the cities (BroadcastFrame's `topCities`): a place's biggest, or — for a
 * targeted event — the towns under the warning / nearest the event, and says
 * which through `basis` so the overview's heading matches the list.
 *
 * The per-city pages used to be a "featured slot" INSIDE the overview card that
 * swapped every 7 seconds. That was a slide show hidden inside a slide: the deck
 * had begun scrolling the card's body at the channel's reading pace, and
 * half-way down the featured block would change under the viewer. A card's
 * content must hold still for as long as the card is on air, so each city is now
 * a real slide the deck turns to in its own time (see SlideDeck / run-pacing).
 */
import { formatPopulation, type City } from "../../lib/cities";
import { usePointForecastDays } from "../../lib/focus/focus-client";
import type { TopCitiesBasis } from "../../lib/focus/types";
import { WeatherGlyph } from "./glyphs";
import { formatReading } from "./PointHistoryPanel";
import BroadcastCard, { CardSection } from "./BroadcastCard";

/** A stable, id-safe instance key for one city's slide (`topcities:<key>`). */
export function citySlideKey(city: City): string {
  return String(city.id ?? `${city.lng},${city.lat}`).replace(/:/g, "-");
}

/** One overview row: thumbnail, name, then population and capital status. */
function TopCityRow({ city }: { city: City }) {
  const meta = [city.population != null ? `Population ${formatPopulation(city.population)}` : null, city.isCapital ? "capital" : null].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "4px 0" }}>
      {city.wikiThumb || city.wikiPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={city.wikiThumb || city.wikiPhoto} alt={`${city.name} city view`}
          style={{ width: 64, height: 44, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
      ) : null}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {city.name}
        </div>
        {meta ? <div style={{ color: "#8ea3bf", whiteSpace: "nowrap" }}>{meta}</div> : null}
      </div>
    </div>
  );
}

function CityWeather({ city }: { city: City }) {
  const { days, loading } = usePointForecastDays([city.lng, city.lat]);
  const today = days[0];
  const reading = (value: number | null | undefined, unit: string) => value == null ? "—" : `${formatReading(value)} ${unit}`;
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", background: "#0b1a24", border: "1px solid #21404d", borderRadius: 5 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.7, color: "#aebfd6", marginBottom: 7 }}>
        TODAY’S WEATHER · {city.name.toUpperCase()}
      </div>
      {today ? <>
        <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#e6eefb" }}>
          <WeatherGlyph condition={today.condition} size={28} />
          <span style={{ textTransform: "capitalize" }}>{today.condition.replace(/-/g, " ")}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 7, color: "#e6eefb", fontSize: 13 }}>
          <div><div style={{ color: "#8ea3bf", fontSize: 10 }}>High / low (°C)</div>{reading(today.hiTemp, "°")} / {reading(today.loTemp, "°")}</div>
          <div><div style={{ color: "#8ea3bf", fontSize: 10 }}>Wind</div>{reading(today.windAvg, "m/s")}</div>
          <div><div style={{ color: "#8ea3bf", fontSize: 10 }}>Chance of rain</div>{reading(today.precipChance, "%")}</div>
        </div>
      </> : <div style={{ fontSize: 12, color: "#8ea3bf" }}>{loading ? "Loading city forecast…" : "City forecast unavailable"}</div>}
    </div>
  );
}

/**
 * ONE city, one slide: the establishing photo, the name and population, the
 * Wikipedia blurb in full (the deck scrolls the body, so it is no longer
 * clamped to two lines) and today's weather there.
 */
export function TopCityPanel({
  city,
  rank,
  total,
  color = "#3f8f8f",
}: {
  city: City;
  /** 1-based position in the guide's order, for the page label. */
  rank: number;
  total: number;
  color?: string;
}) {
  return (
    <BroadcastCard accent={color} eyebrow="City Guide">
      <div style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: 1, marginBottom: 6 }}>
        CITY {rank} OF {total}
      </div>
      {city.wikiPhoto || city.wikiThumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={city.wikiPhoto || city.wikiThumb}
          alt={`${city.name} city view`}
          style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 7, display: "block", marginBottom: 9 }}
        />
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "3px 10px" }}>
        <span style={{ fontSize: 24.2, fontWeight: 800, color: "#fff" }}>{city.name}</span>
        {formatPopulation(city.population) ? (
          <span style={{ fontSize: 15.4, fontWeight: 700, color }}>Population {formatPopulation(city.population)}</span>
        ) : null}
      </div>
      <div style={{ fontSize: 15.4, fontWeight: 600, color: "#aebfd6", marginTop: 2 }}>
        {[city.country, city.isCapital ? "capital" : null].filter(Boolean).join(" · ")}
      </div>
      {city.wikiExtract ? (
        <div style={{ fontSize: 14.3, lineHeight: 1.5, color: "#cdd9ec", marginTop: 7 }}>{city.wikiExtract}</div>
      ) : null}

      <CityWeather city={city} />
    </BroadcastCard>
  );
}

/** The overview heading says HOW the list was picked — a targeted event's guide
 *  is the towns under the warning or the nearest ones, not "biggest in frame". */
export function cityGuideHeading(basis: TopCitiesBasis | null | undefined): string {
  switch (basis) {
    case "footprint":
      return "CITIES UNDER THIS WARNING · BY POPULATION";
    case "nearest":
      return "NEAREST TOWNS · BY DISTANCE";
    default:
      return "MAJOR CITIES · BY POPULATION";
  }
}

/**
 * The overview page: every city in the guide, in the caller's order (biggest
 * first for a place or a warning footprint, closest first for a nearest list).
 * The per-city pages follow it in the deck, so this is the contents list, not
 * a teaser.
 */
export default function TopCitiesPanel({
  cities,
  basis,
  color = "#3f8f8f",
}: {
  cities: City[];
  basis?: TopCitiesBasis | null;
  color?: string;
}) {
  if (!cities.length) return null;

  return (
    <BroadcastCard accent={color} eyebrow="City Guide">
      <CardSection first style={{ fontSize: 14.3 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#aebfd6", letterSpacing: 0.5, marginBottom: 7 }}>
          {cityGuideHeading(basis)}
        </div>
        {cities.map((c) => (
          <TopCityRow key={citySlideKey(c)} city={c} />
        ))}
      </CardSection>
    </BroadcastCard>
  );
}
