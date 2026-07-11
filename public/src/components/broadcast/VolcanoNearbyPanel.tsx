"use client";

/**
 * On-air "third slide" for an active volcano segment — what else is happening
 * around it: notable nearby cities, recent nearby seismic activity (a volcano's
 * unrest is very often accompanied by a local earthquake swarm), and any active
 * weather alerts in range. Alternated with TrackInfoPanel/VolcanoFactsPanel by
 * BroadcastFrame's volcanoSlide the same way those two already alternate — a
 * fourth stacked card would run taller than the frame. Returns null when
 * nothing is within range of any of the three lists, so callers should check
 * `volcanoNearbySlideHasContent` before adding this as a page.
 */
import type { City } from "../../lib/cities";
import { formatPopulation } from "../../lib/cities";
import type { Quake } from "@photonsurge/shared/tracks/types";
import type { AlertFeature } from "../../lib/alerts";
import { SEVERITY_LABELS, SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";
import { quakeMagnitudeLabel, quakeMagnitudeColor } from "@photonsurge/shared/seismic";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import { nearby, formatKm, bearingLabel } from "../../lib/geo";
import BroadcastCard, { CardSection } from "./BroadcastCard";
import { CityForecastStrip, useCityWeatherByIds } from "./CityForecastStrip";

const CITY_RADIUS_KM = 500;
const QUAKE_RADIUS_KM = 500;
const ALERT_RADIUS_KM = 500;
const MAX_ROWS = 4;

const cityPoint = (c: City): [number, number] => [c.lng, c.lat];
const quakePoint = (q: Quake): [number, number] => [q.lng, q.lat];
const alertPoint = (a: AlertFeature): [number, number] | null => alertRepPoint(a.geometry);

/** "12m ago" / "3h ago" / "2d ago" — coarse elapsed time for a nearby-quake row. */
function agoLabel(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function nearbyCities(center: [number, number], cities: City[]) {
  return nearby(
    cities.filter((c) => (c.population ?? 0) > 0 || c.isCapital),
    center,
    cityPoint,
    CITY_RADIUS_KM,
  ).slice(0, MAX_ROWS);
}
function nearbyQuakes(center: [number, number], quakes: Quake[]) {
  return nearby(quakes, center, quakePoint, QUAKE_RADIUS_KM).slice(0, MAX_ROWS);
}
function nearbyAlerts(center: [number, number], alerts: AlertFeature[]) {
  return nearby(alerts, center, alertPoint, ALERT_RADIUS_KM).slice(0, MAX_ROWS);
}

export function volcanoNearbySlideHasContent(
  center: [number, number],
  cities: City[],
  quakes: Quake[],
  alerts: AlertFeature[],
): boolean {
  return (
    nearbyCities(center, cities).length > 0 ||
    nearbyQuakes(center, quakes).length > 0 ||
    nearbyAlerts(center, alerts).length > 0
  );
}

export default function VolcanoNearbyPanel({
  center,
  cities,
  quakes,
  alerts,
  color = "#38bdf8",
}: {
  /** Volcano [lng, lat]. */
  center: [number, number];
  cities: City[];
  quakes: Quake[];
  alerts: AlertFeature[];
  color?: string;
}) {
  const near = nearbyCities(center, cities);
  const nearQ = nearbyQuakes(center, quakes);
  const nearA = nearbyAlerts(center, alerts);

  // Live now + 3-day forecast per nearby town (worker cache, by city id — only
  // ≥100k-pop cities are cached, smaller ones just carry no weather block).
  const weather = useCityWeatherByIds(near.map((n) => n.item.id));

  if (!near.length && !nearQ.length && !nearA.length) return null;

  return (
    <BroadcastCard accent={color} eyebrow="Nearby">
      {near.length ? (
        <CardSection first eyebrow="Nearest Cities">
          {near.map((n) => (
            <div key={n.item.id} style={{ padding: "3px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 11 }}>
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
              <CityForecastStrip city={weather.get(n.item.id)} color={color} />
            </div>
          ))}
        </CardSection>
      ) : null}

      {nearQ.length ? (
        <CardSection first={!near.length} eyebrow="Nearby Seismic Activity">
          {nearQ.map((n) => (
            <div key={n.item.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, padding: "2px 0" }}>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  color: "#0a0e16",
                  background: quakeMagnitudeColor(n.item.mag),
                  padding: "1px 5px",
                  borderRadius: 4,
                  flexShrink: 0,
                }}
              >
                M{n.item.mag.toFixed(1)}
              </span>
              <span style={{ minWidth: 0, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#cdd9ec" }}>
                {n.item.place ?? quakeMagnitudeLabel(n.item.mag)}
              </span>
              <span style={{ color: "#8ea3bf", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {formatKm(n.distanceKm)} · {agoLabel(n.item.time)}
              </span>
            </div>
          ))}
        </CardSection>
      ) : null}

      {nearA.length ? (
        <CardSection first={!near.length && !nearQ.length} eyebrow="Nearby Alerts">
          {nearA.map((n) => (
            <div key={n.item.properties.id} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11, padding: "2px 0" }}>
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: SEVERITY_COLORS[n.item.properties.severityRank],
                  flexShrink: 0,
                }}
              />
              <span style={{ minWidth: 0, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#cdd9ec" }}>
                {n.item.properties.translatedHeadline || n.item.properties.event}
                {n.item.properties.areaDesc ? (
                  <span style={{ color: "#7d8da5" }}>{` · ${n.item.properties.areaDesc}`}</span>
                ) : null}
              </span>
              <span style={{ color: "#8ea3bf", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {SEVERITY_LABELS[n.item.properties.severityRank]} · {formatKm(n.distanceKm)}
              </span>
            </div>
          ))}
        </CardSection>
      ) : null}
    </BroadcastCard>
  );
}
