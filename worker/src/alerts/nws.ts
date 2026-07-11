import { rankFromCapSeverity } from "@photonsurge/shared/alerts/severity";
import { canonicaliseCapMessages } from "@photonsurge/shared/alerts/normalise";
import type {
  AlertSource,
  CapMessage,
  CapInfo,
  RawPayload,
} from "@photonsurge/shared/alerts/types";
import type { AlertMsgType, AlertStatus } from "@photonsurge/shared/db/alert-model";

/**
 * NWS adapter (spec §2, the gold standard). `/alerts/active` returns a GeoJSON
 * FeatureCollection that is already CAP-shaped, so parsing is a field map — no
 * XML. A User-Agent identifying the app + contact is MANDATORY (NWS rejects
 * anonymous clients); one `/active` pull per tick covers the whole US.
 */
const NWS_ACTIVE_URL = "https://api.weather.gov/alerts/active";

const userAgent = () =>
  process.env.ALERTS_NWS_USER_AGENT ||
  "LiveWeatherGlobe/0.1 (personal weather globe; ravergeek@gmail.com)";

/** NWS `parameters` is Record<string, string[]>; flatten to Record<string,string>. */
function flattenParameters(params: unknown): Record<string, string> | undefined {
  if (!params || typeof params !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

/** NWS `geocode` is { SAME: string[], UGC: string[] }; flatten to {valueName,value}[]. */
function buildGeocodes(geocode: unknown): { valueName: string; value: string }[] {
  if (!geocode || typeof geocode !== "object") return [];
  const out: { valueName: string; value: string }[] = [];
  for (const [valueName, values] of Object.entries(geocode as Record<string, unknown>)) {
    if (Array.isArray(values)) for (const value of values) out.push({ valueName, value: String(value) });
  }
  return out;
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return v == null || v === "" ? [] : [String(v)];
}

function featureToCapMessage(feature: any): CapMessage | null {
  const p = feature?.properties;
  if (!p?.id) return null;

  const info: CapInfo = {
    language: p.language || "en-US",
    category: asArray(p.category),
    event: p.event ?? "",
    urgency: p.urgency,
    severity: p.severity,
    certainty: p.certainty,
    severityRank: rankFromCapSeverity(p.severity),
    onset: p.onset ?? undefined,
    effective: p.effective ?? undefined,
    expires: p.expires ?? p.ends ?? undefined,
    headline: p.headline ?? undefined,
    description: p.description ?? undefined,
    instruction: p.instruction ?? undefined,
    web: feature.id || p["@id"] || undefined,
    sourceSeverity: p.severity ?? undefined,
    parameters: flattenParameters(p.parameters),
    area: [
      {
        areaDesc: p.areaDesc ?? "",
        geometry: feature.geometry ?? null,
        geocodes: buildGeocodes(p.geocode),
      },
    ],
  };

  return {
    source: "nws",
    identifier: String(p.id),
    sender: p.sender ?? "",
    sent: p.sent ?? "",
    msgType: (p.messageType ?? "Alert") as AlertMsgType,
    status: (p.status ?? "Actual") as AlertStatus,
    scope: "Public",
    references: Array.isArray(p.references)
      ? p.references.map((r: any) => `${r.sender ?? ""},${r.identifier ?? ""},${r.sent ?? ""}`)
      : [],
    info: [info],
    raw: feature,
  };
}

export const nwsSource: AlertSource = {
  id: "nws",
  region: "United States + US Pacific",
  pollIntervalSec: Number(process.env.NWS_POLL_SEC || 60),
  enabled: true,
  reconcile: true, // single API fetch = reliable full snapshot of active US alerts

  async fetch(): Promise<RawPayload[]> {
    const res = await fetch(NWS_ACTIVE_URL, {
      headers: { "User-Agent": userAgent(), Accept: "application/geo+json" },
    });
    if (!res.ok) throw new Error(`nws fetch failed: ${res.status} ${res.statusText}`);
    const body = await res.text();
    return [
      {
        contentType: res.headers.get("content-type") ?? "application/geo+json",
        body,
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
        continue; // skip unparseable payloads, don't kill the tick
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
