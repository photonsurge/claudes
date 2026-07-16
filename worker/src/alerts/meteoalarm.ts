import { rankFromCapSeverity, rankFromMeteoalarmLevel } from "@photonsurge/shared/alerts/severity";
import { canonicaliseCapMessages } from "@photonsurge/shared/alerts/normalise";
import { windRing } from "@photonsurge/shared/alerts/rings";
import type {
  AlertSource,
  CapMessage,
  CapInfo,
  RawPayload,
} from "@photonsurge/shared/alerts/types";
import type { AlertGeometry, AlertMsgType, AlertStatus } from "@photonsurge/shared/db/alert-model";

/**
 * MeteoAlarm adapter — pan-European warnings (EUMETNET). One JSON feed per
 * country at `/api/v1/warnings/feeds-<country>`; the payload is already CAP-
 * shaped (`{ warnings: [{ alert }] }`), so parsing is a field map like NWS — no
 * XML. There is no single Europe feed, so we fan out across countries and
 * tolerate per-country failures (one bad country must not kill the tick).
 *
 * Geometry: in practice this feed does NOT include CAP `polygon`s — an area is a
 * name plus an `EMMA_ID` geocode, so `geometry` parses to null and the alert has
 * no shape to draw. `polygonToGeometry` stays because the CAP field is legal and
 * a member may yet send it. The footprint is filled in at ingest by joining the
 * EMMA boundary cache (see `enrich-geometry.ts` / `meteogate.ts`).
 */
const BASE = "https://feeds.meteoalarm.org/api/v1/warnings/feeds-";

/** EUMETNET member feeds (slugs verified live). Override with METEOALARM_COUNTRIES. */
const DEFAULT_COUNTRIES = [
  "austria", "belgium", "bosnia-herzegovina", "bulgaria", "croatia", "cyprus",
  "czechia", "denmark", "estonia", "finland", "france", "germany", "greece",
  "hungary", "iceland", "ireland", "israel", "italy", "latvia", "lithuania",
  "luxembourg", "malta", "moldova", "montenegro", "netherlands", "norway",
  "poland", "portugal", "republic-of-north-macedonia", "romania", "serbia",
  "slovakia", "slovenia", "spain", "sweden", "switzerland", "united-kingdom",
];

const countries = (): string[] =>
  (process.env.METEOALARM_COUNTRIES || DEFAULT_COUNTRIES.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const userAgent = () =>
  process.env.ALERTS_METEOALARM_USER_AGENT ||
  process.env.ALERTS_NWS_USER_AGENT ||
  "LiveWeatherGlobe/0.1 (personal weather globe; ravergeek@gmail.com)";

/** MeteoAlarm `parameter` is [{valueName,value}]; flatten to Record<string,string>. */
function flattenParameters(params: unknown): Record<string, string> | undefined {
  if (!Array.isArray(params)) return undefined;
  const out: Record<string, string> = {};
  for (const p of params as { valueName?: string; value?: string }[]) {
    if (p?.valueName) out[p.valueName] = String(p.value ?? "");
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * CAP polygon "lat,lon lat,lon …" → a closed, CCW-wound GeoJSON ring [lon,lat][]
 * (or null). CAP gives lat,lon; GeoJSON wants lon,lat. Closure and winding are
 * both required by Mongo's 2dsphere index — see `windRing`.
 */
function parseRing(s: string): [number, number][] | null {
  const ring: [number, number][] = [];
  for (const pair of s.trim().split(/\s+/)) {
    const [lat, lon] = pair.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    ring.push([lon, lat]);
  }
  return windRing(ring, true);
}

/** MeteoAlarm `area.polygon` (string | string[]) → GeoJSON Polygon/MultiPolygon. */
function polygonToGeometry(polygon: unknown): AlertGeometry | null {
  const strings = Array.isArray(polygon) ? polygon : typeof polygon === "string" ? [polygon] : [];
  const rings = strings
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map(parseRing)
    .filter((r): r is [number, number][] => !!r);
  if (!rings.length) return null;
  if (rings.length === 1) return { type: "Polygon", coordinates: [rings[0]] };
  return { type: "MultiPolygon", coordinates: rings.map((r) => [r]) };
}

function buildGeocodes(geocode: unknown): { valueName: string; value: string }[] {
  if (!Array.isArray(geocode)) return [];
  return (geocode as { valueName?: string; value?: unknown }[])
    .filter((g) => g?.valueName != null)
    .map((g) => ({ valueName: String(g.valueName), value: String(g.value ?? "") }));
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return v == null || v === "" ? [] : [String(v)];
}

function toCapInfo(info: any): CapInfo {
  const parameters = flattenParameters(info.parameter);
  return {
    language: info.language || "en",
    category: asArray(info.category),
    event: info.event ?? "",
    urgency: info.urgency,
    severity: info.severity,
    certainty: info.certainty,
    // MeteoAlarm's OWN awareness level, not its CAP `severity` field — they
    // disagree, and the level is the one it means. 58% of the live feed
    // contradicted the CAP-derived rank, almost all of it green ("nothing
    // expected") arriving as Minor warnings. CAP severity is only the fallback,
    // for an alert that ships no level. See rankFromMeteoalarmLevel.
    severityRank: rankFromMeteoalarmLevel(parameters?.awareness_level) ?? rankFromCapSeverity(info.severity),
    onset: info.onset ?? undefined,
    effective: info.effective ?? undefined,
    expires: info.expires ?? undefined,
    headline: info.headline ?? undefined,
    description: info.description ?? undefined,
    instruction: info.instruction ?? undefined,
    web: info.web ?? undefined,
    sourceSeverity: info.severity ?? undefined,
    parameters,
    area: (Array.isArray(info.area) ? info.area : []).map((ar: any) => ({
      areaDesc: ar?.areaDesc ?? "",
      geometry: polygonToGeometry(ar?.polygon),
      geocodes: buildGeocodes(ar?.geocode),
    })),
  };
}

export function alertToCapMessage(alert: any): CapMessage | null {
  if (!alert?.identifier) return null;
  const infos = Array.isArray(alert.info) ? alert.info : [];
  if (!infos.length) return null;

  return {
    source: "meteoalarm",
    identifier: String(alert.identifier),
    sender: alert.sender ?? "",
    sent: alert.sent ?? "",
    msgType: (alert.msgType ?? "Alert") as AlertMsgType,
    status: (alert.status ?? "Actual") as AlertStatus,
    scope: alert.scope ?? "Public",
    // CAP references: whitespace-delimited "sender,identifier,sent" triples.
    references:
      typeof alert.references === "string"
        ? alert.references.split(/\s+/).filter(Boolean)
        : Array.isArray(alert.references)
          ? alert.references.map((r: any) =>
              typeof r === "string" ? r : `${r?.sender ?? ""},${r?.identifier ?? ""},${r?.sent ?? ""}`,
            )
          : [],
    info: infos.map(toCapInfo),
    raw: alert,
  };
}

export const meteoalarmSource: AlertSource = {
  id: "meteoalarm",
  region: "Europe (EUMETNET)",
  pollIntervalSec: Number(process.env.METEOALARM_POLL_SEC || 300),
  enabled: process.env.ALERTS_METEOALARM_ENABLED !== "false",

  async fetch(): Promise<RawPayload[]> {
    const results = await Promise.allSettled(
      countries().map(async (c) => {
        const res = await fetch(`${BASE}${c}`, {
          headers: { "User-Agent": userAgent(), Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`${c}: ${res.status} ${res.statusText}`);
        return {
          contentType: res.headers.get("content-type") ?? "application/json",
          body: await res.text(),
          fetchedAt: new Date().toISOString(),
        } as RawPayload;
      }),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<RawPayload> => r.status === "fulfilled")
      .map((r) => r.value);
  },

  parse(raw: RawPayload[]): CapMessage[] {
    const msgs: CapMessage[] = [];
    for (const payload of raw) {
      let doc: any;
      try {
        doc = JSON.parse(payload.body);
      } catch {
        continue; // skip unparseable payloads, don't kill the tick
      }
      const warnings = Array.isArray(doc?.warnings) ? doc.warnings : [];
      for (const w of warnings) {
        const m = alertToCapMessage(w?.alert);
        if (m) msgs.push(m);
      }
    }
    return msgs;
  },

  normalise(msgs: CapMessage[], now = new Date()) {
    return canonicaliseCapMessages(msgs, now);
  },
};
