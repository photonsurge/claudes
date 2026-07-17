import { canonicaliseCapMessages } from "@photonsurge/shared/alerts/normalise";
import { fetchWithTimeout, discardBody } from "../http";
import type {
  AlertSource,
  CapMessage,
  CapInfo,
  RawPayload,
} from "@photonsurge/shared/alerts/types";
import type { AlertGeometry, SeverityRank } from "@photonsurge/shared/db/alert-model";

/**
 * GDACS adapter — the global catch-all (Asia, Africa, Oceania, S. America …).
 * GDACS aggregates worldwide hazard events as a GeoJSON FeatureCollection, so
 * parsing is a field map like NWS/MeteoAlarm. We keep WEATHER hazards only —
 * earthquakes are dropped (the USGS seismic overlay owns those). Alert level
 * (Green/Orange/Red) → severityRank; the GDACS event code → a clean event name.
 */
const FEED = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP";

/** GDACS event codes → clean event names. EQ is intentionally absent (skipped). */
const EVENT_NAMES: Record<string, string> = {
  TC: "Tropical Cyclone",
  FL: "Flood",
  FF: "Flash Flood",
  DR: "Drought",
  WF: "Wildfire",
  VO: "Volcanic Activity",
  TS: "Tsunami",
};

/** CAP category per hazard type. */
const EVENT_CATEGORY: Record<string, string> = {
  TC: "Met",
  FL: "Met",
  FF: "Met",
  DR: "Met",
  WF: "Fire",
  VO: "Geo",
  TS: "Geo",
};

/** GDACS alert level → normalised severityRank + CAP-ish severity word. */
function severityFromLevel(level: string): { rank: SeverityRank; severity: string } {
  switch ((level || "").trim().toLowerCase()) {
    case "red":
      return { rank: 4, severity: "Extreme" };
    case "orange":
      return { rank: 3, severity: "Severe" };
    case "green":
      return { rank: 2, severity: "Moderate" };
    default:
      return { rank: 0, severity: "Unknown" };
  }
}

const userAgent = () =>
  process.env.ALERTS_GDACS_USER_AGENT ||
  "Mozilla/5.0 LiveWeatherGlobe/0.1 (personal weather globe; ravergeek@gmail.com)";

/** Keep only a valid GeoJSON geometry with coordinates. */
function cleanGeometry(geometry: unknown): AlertGeometry | null {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (g && typeof g.type === "string" && g.coordinates != null) {
    return { type: g.type, coordinates: g.coordinates };
  }
  return null;
}

function featureToCapMessage(feature: any): CapMessage | null {
  const p = feature?.properties;
  const eventType: string = p?.eventtype;
  if (!p || !eventType) return null;
  if (eventType === "EQ") return null; // owned by the USGS seismic overlay
  const eventName = EVENT_NAMES[eventType];
  if (!eventName) return null; // unknown / non-weather hazard

  const id = String(p.eventid ?? p.eventName ?? "");
  if (!id) return null;
  const { rank, severity } = severityFromLevel(p.alertlevel);

  const country = typeof p.country === "string" ? p.country : "";
  const web =
    p.url?.report ||
    `https://www.gdacs.org/report.aspx?eventtype=${eventType}&eventid=${id}`;

  const parameters: Record<string, string> = {
    gdacsEventType: eventType,
    alertLevel: String(p.alertlevel ?? ""),
  };
  if (country) parameters.country = country;
  if (p.severitydata?.severitytext) parameters.severity = String(p.severitydata.severitytext);
  if (p.episodeid != null) parameters.episode = String(p.episodeid);

  // GDACS `todate` is the event's modelled end — for slow hazards (floods,
  // droughts) it's often already in the PAST, which would mark the alert
  // expired/inactive even though it's still a current event in the feed. So only
  // expire on a FUTURE todate; otherwise leave it open (it's live while listed).
  const todate = typeof p.todate === "string" ? p.todate : "";
  const expires = todate && Date.parse(todate) > Date.now() ? todate : undefined;

  const info: CapInfo = {
    language: "en",
    category: [EVENT_CATEGORY[eventType] ?? "Met"],
    event: eventName,
    urgency: "Expected",
    severity,
    certainty: "Observed",
    severityRank: rank,
    onset: p.fromdate ?? undefined,
    effective: p.fromdate ?? undefined,
    expires,
    headline: p.eventname || (typeof p.htmldescription === "string" ? p.htmldescription : undefined),
    description: typeof p.description === "string" ? p.description : p.htmldescription,
    instruction: undefined,
    web,
    sourceSeverity: String(p.alertlevel ?? ""),
    parameters,
    area: [
      {
        areaDesc: country || eventName,
        geometry: cleanGeometry(feature.geometry),
        geocodes: [],
      },
    ],
  };

  return {
    source: "gdacs",
    identifier: `${eventType}${id}`,
    sender: "GDACS",
    sent: p.fromdate ?? "",
    msgType: "Alert",
    status: "Actual",
    scope: "Public",
    references: [],
    info: [info],
    raw: feature,
  };
}

export const gdacsSource: AlertSource = {
  id: "gdacs",
  region: "Global (GDACS)",
  pollIntervalSec: Number(process.env.GDACS_POLL_SEC || 900),
  enabled: process.env.ALERTS_GDACS_ENABLED !== "false",
  reconcile: true, // single fetch = reliable full snapshot

  async fetch(): Promise<RawPayload[]> {
    const res = await fetchWithTimeout(FEED, {
      timeoutMs: Number(process.env.GDACS_FETCH_TIMEOUT_MS || 30_000),
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
    });
    if (!res.ok) {
      discardBody(res);
      throw new Error(`gdacs fetch failed: ${res.status} ${res.statusText}`);
    }
    return [
      {
        contentType: res.headers.get("content-type") ?? "application/json",
        body: await res.text(),
        fetchedAt: new Date().toISOString(),
      },
    ];
  },

  parse(raw: RawPayload[]): CapMessage[] {
    const msgs: CapMessage[] = [];
    for (const payload of raw) {
      let fc: any;
      try {
        fc = JSON.parse(payload.body);
      } catch {
        continue;
      }
      const features = Array.isArray(fc?.features) ? fc.features : [];
      for (const f of features) {
        const m = featureToCapMessage(f);
        if (m) msgs.push(m);
      }
    }
    return msgs;
  },

  normalise(msgs: CapMessage[], now = new Date()) {
    return canonicaliseCapMessages(msgs, now);
  },
};
