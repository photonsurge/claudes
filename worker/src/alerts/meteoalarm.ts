import { rankFromCapSeverity } from "@photonsurge/shared/alerts/severity";
import { canonicaliseCapMessages } from "@photonsurge/shared/alerts/normalise";
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
 * tolerate per-country failures (one bad country must not kill the tick). Areas
 * carry CAP `polygon`s (array of "lat,lon …" rings) which we convert to GeoJSON.
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
 * CAP polygon "lat,lon lat,lon …" → a closed GeoJSON ring [lon,lat][] (or null).
 * CAP gives lat,lon; GeoJSON wants lon,lat. Drops adjacent duplicate vertices and
 * closes the ring (both required by Mongo's 2dsphere index).
 */
function parseRing(s: string): [number, number][] | null {
  const ring: [number, number][] = [];
  for (const pair of s.trim().split(/\s+/)) {
    const [lat, lon] = pair.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const prev = ring[ring.length - 1];
    if (!prev || prev[0] !== lon || prev[1] !== lat) ring.push([lon, lat]);
  }
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  // Mongo's 2dsphere reads a clockwise small-region ring as its complement
  // ("bigger than a hemisphere" → rejected). Force CCW so it stores correctly.
  return signedArea(ring) < 0 ? ring.reverse() : ring;
}

/** Shoelace signed area of a closed [lon,lat] ring; >0 == counter-clockwise. */
function signedArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
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
  return {
    language: info.language || "en",
    category: asArray(info.category),
    event: info.event ?? "",
    urgency: info.urgency,
    severity: info.severity,
    certainty: info.certainty,
    severityRank: rankFromCapSeverity(info.severity),
    onset: info.onset ?? undefined,
    effective: info.effective ?? undefined,
    expires: info.expires ?? undefined,
    headline: info.headline ?? undefined,
    description: info.description ?? undefined,
    instruction: info.instruction ?? undefined,
    web: info.web ?? undefined,
    sourceSeverity: info.severity ?? undefined,
    parameters: flattenParameters(info.parameter),
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
