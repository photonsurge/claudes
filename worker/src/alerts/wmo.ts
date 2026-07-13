import { canonicaliseCapMessages } from "@photonsurge/shared/alerts/normalise";
import type {
  AlertSource,
  CapMessage,
  CapInfo,
  RawPayload,
} from "@photonsurge/shared/alerts/types";
import type { AlertGeometry, SeverityRank } from "@photonsurge/shared/db/alert-model";

/**
 * WMO SWIC adapter — the global catch-all. The WMO Severe Weather Information
 * Centre aggregates every member met-service's CAP warnings into one PostGIS
 * layer, served as GeoJSON over WFS (`/g/ows/`). One query returns the whole
 * planet's active warnings with polygons + severity. We dedupe the multi-polygon
 * rows back to one alert per `capurl`, and SKIP the authorities our dedicated
 * adapters already own (NWS = US, MeteoAlarm = EUMETNET Europe) so they aren't
 * double-ingested — WMO fills the rest of the world (China, Russia, Canada …).
 */
const OWS = "https://severeweather.wmo.int/g/ows/";
const TYPENAME = "local_postgis:timeshift_warning_view";

/**
 * Country prefixes (ISO-2, the lead segment of a WMO `capurl` like
 * "cn-cma-xx/…") to SKIP. Empty by default — WMO is the single global source, so
 * it ingests the whole planet (US, Europe and all). Only set WMO_EXCLUDE_CC (e.g.
 * "us,at,be,…") if you also run the dedicated NWS / MeteoAlarm adapters
 * (ALERTS_REGIONAL=true) and want WMO to fill just the gaps they leave.
 */
const DEFAULT_EXCLUDE_CC: string[] = [];

const excludeCC = (): Set<string> =>
  new Set(
    (process.env.WMO_EXCLUDE_CC ?? DEFAULT_EXCLUDE_CC.join(","))
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

const userAgent = () =>
  process.env.ALERTS_WMO_USER_AGENT ||
  "Mozilla/5.0 LiveWeatherGlobe/0.1 (personal weather globe; ravergeek@gmail.com)";

/**
 * WMO `s` is a CAP severity ordinal that lines up 1:1 with our severityRank:
 * 0 Unknown · 1 Minor · 2 Moderate · 3 Severe · 4 Extreme (verified by correlating
 * the feed against WMO's published per-country counts, e.g. US "Air Quality Alert"
 * = s 0 = Unknown). So rank = s.
 */
const SEV_WORD = ["Unknown", "Minor", "Moderate", "Severe", "Extreme"];
function severityFromS(s: unknown): { rank: SeverityRank; severity: string } {
  const n = typeof s === "number" && Number.isFinite(s) ? s : 0;
  const rank = Math.max(0, Math.min(4, n)) as SeverityRank;
  return { rank, severity: SEV_WORD[rank] };
}

/** Shoelace signed area of a closed [lon,lat] ring; >0 == counter-clockwise. */
function signedArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

const eq = (a: number[], b: number[]): boolean => a[0] === b[0] && a[1] === b[1];

/** Drop cyclically-adjacent duplicate points from an open (unclosed) ring. */
function dedupeCyclic(pts: number[][]): number[][] {
  const out: number[][] = [];
  for (const p of pts) {
    if (!out.length || !eq(out[out.length - 1], p)) out.push(p);
  }
  while (out.length > 1 && eq(out[0], out[out.length - 1])) out.pop();
  return out;
}

/**
 * Remove degenerate spikes: a vertex whose two neighbours coincide (an
 * out-and-back A→B→A, or a P,Q,P,Q zigzag sliver) is a zero-area protrusion
 * that S2 rejects as a duplicate/degenerate edge. Strip the tip and re-dedupe
 * until the ring is stable. Operates on an open ring; mutates a copy.
 */
function dropSpikes(input: number[][]): number[][] {
  let pts = input;
  for (;;) {
    if (pts.length < 3) return pts;
    const n = pts.length;
    let spike = -1;
    for (let i = 0; i < n; i++) {
      if (eq(pts[(i - 1 + n) % n], pts[(i + 1) % n])) {
        spike = i;
        break;
      }
    }
    if (spike < 0) return pts;
    pts = dedupeCyclic([...pts.slice(0, spike), ...pts.slice(spike + 1)]);
  }
}

/**
 * Clean a ring for Mongo's 2dsphere: drop non-finite / out-of-range /
 * adjacent-duplicate points, strip degenerate spikes, then close it. Returns
 * null if too few distinct points remain to form a ring.
 */
function cleanRing(ring: number[][]): number[][] | null {
  const pts: number[][] = [];
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const [x, y] = pt;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < -180 || x > 180 || y < -90 || y > 90) continue; // outside lon/lat range
    const prev = pts[pts.length - 1];
    if (!prev || prev[0] !== x || prev[1] !== y) pts.push([x, y]);
  }
  const cleaned = dropSpikes(dedupeCyclic(pts));
  if (cleaned.length < 3) return null;
  return [...cleaned, [cleaned[0][0], cleaned[0][1]]]; // close the ring
}

/**
 * Sanitise one polygon: clean every ring, then force the outer ring CCW (holes
 * CW) — Mongo reads a clockwise outer ring as "bigger than a hemisphere" and
 * rejects it. Returns null if the outer ring can't be salvaged.
 */
function sanitizePolygon(poly: number[][][]): number[][][] | null {
  const rings: number[][][] = [];
  for (const raw of poly) {
    const ring = cleanRing(raw);
    if (!ring) {
      if (!rings.length) return null; // outer ring is unsalvageable
      continue; // drop a bad hole, keep the polygon
    }
    const wantCCW = rings.length === 0; // first kept ring is the outer
    rings.push(signedArea(ring) > 0 === wantCCW ? ring : [...ring].reverse());
  }
  return rings.length ? rings : null;
}

/** A GeoJSON geometry → a flat list of its polygons (each a ring array). */
function toPolygons(g: unknown): number[][][][] {
  const geom = g as { type?: string; coordinates?: unknown } | null;
  if (!geom || !geom.coordinates) return [];
  if (geom.type === "Polygon") return [geom.coordinates as number[][][]];
  if (geom.type === "MultiPolygon") return geom.coordinates as number[][][][];
  return [];
}

/**
 * Fallback representative point: the mean of every finite, in-range [lon,lat] vertex
 * across a capurl's raw geometries. Rescues a location for alerts whose polygon is
 * absent or too degenerate to survive `sanitizePolygon` (many CMA warnings — "high
 * temperature", "Typhoon" — arrive area-name-only or as unsalvageable rings). Such an
 * alert becomes a *point-only* alert (a hazard badge at the point, which the overlay
 * already supports) and, once promoted, a LOCATED WatchedEvent instead of one with no
 * geometry at all (which used to leave repPoint empty → a failed 2dsphere upsert).
 */
function verticesCentroid(geoms: unknown[]): AlertGeometry | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const visit = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const [x, y] = c as number[];
      if (Number.isFinite(x) && Number.isFinite(y) && x >= -180 && x <= 180 && y >= -90 && y <= 90) {
        sx += x;
        sy += y;
        n++;
      }
      return;
    }
    for (const e of c) visit(e);
  };
  for (const g of geoms) {
    const geom = g as { coordinates?: unknown } | null;
    if (geom?.coordinates != null) visit(geom.coordinates);
  }
  return n ? { type: "Point", coordinates: [sx / n, sy / n] } : null;
}

/** Merge a capurl's polygon rows into one wound Polygon/MultiPolygon; when no polygon
 *  survives, fall back to a representative Point (see `verticesCentroid`) so the alert
 *  keeps a location, else null. */
function mergeGeometry(geoms: unknown[]): AlertGeometry | null {
  const polys: number[][][][] = [];
  for (const g of geoms) {
    for (const p of toPolygons(g)) {
      const s = sanitizePolygon(p);
      if (s) polys.push(s);
    }
  }
  if (!polys.length) return verticesCentroid(geoms);
  if (polys.length === 1) return { type: "Polygon", coordinates: polys[0] };
  return { type: "MultiPolygon", coordinates: polys };
}

interface WmoFeature {
  geometry?: unknown;
  properties?: Record<string, any>;
}

/** authority "cn-cma-xx/2026/…" → "cn"; "" if unparseable. */
const ccOf = (capurl: string): string => (capurl.split("/")[0] || "").split("-")[0].toLowerCase();

/** Group WFS features by capurl, drop excluded countries, build one CapMessage each. */
export function featuresToCapMessages(features: WmoFeature[], exclude: Set<string>): CapMessage[] {
  const groups = new Map<string, { props: Record<string, any>; geoms: unknown[] }>();
  for (const f of features) {
    const p = f?.properties;
    const capurl = typeof p?.capurl === "string" ? p.capurl : "";
    if (!capurl) continue;
    if (exclude.has(ccOf(capurl))) continue;
    const g = groups.get(capurl);
    if (g) {
      g.geoms.push(f.geometry);
    } else {
      groups.set(capurl, { props: p as Record<string, any>, geoms: [f.geometry] });
    }
  }

  const msgs: CapMessage[] = [];
  for (const [capurl, { props: p, geoms }] of groups) {
    const { rank, severity } = severityFromS(p.s);
    const authority = capurl.split("/")[0] || "";
    const cc = ccOf(capurl).toUpperCase();
    const areaDesc = (typeof p.areadesc === "string" && p.areadesc.trim()) || cc || authority;

    const parameters: Record<string, string> = { authority, wmoMember: String(p.mem ?? "") };
    if (p.u != null) parameters.urgency = String(p.u);
    if (p.c != null) parameters.certainty = String(p.c);

    const info: CapInfo = {
      category: [p.marine === "1" || p.marine === 1 ? "Marine" : "Met"],
      event: typeof p.event === "string" ? p.event : "",
      urgency: "Expected",
      severity,
      certainty: "Observed",
      severityRank: rank,
      onset: p.onset ?? p.effective ?? undefined,
      effective: p.effective ?? p.onset ?? undefined,
      expires: typeof p.expires === "string" ? p.expires : undefined,
      headline: typeof p.event === "string" ? p.event : undefined,
      description: typeof p.description === "string" ? p.description : undefined,
      instruction: undefined,
      web: `https://severeweather.wmo.int/v2/cap-alerts/${capurl}`,
      sourceSeverity: severity,
      parameters,
      area: [{ areaDesc, geometry: mergeGeometry(geoms), geocodes: [] }],
    };

    msgs.push({
      source: "wmo",
      identifier: capurl,
      sender: authority || "WMO",
      sent: typeof p.sent === "string" ? p.sent : "",
      msgType: "Alert",
      status: "Actual",
      scope: "Public",
      references: [],
      info: [info],
      raw: p,
    });
  }
  return msgs;
}

export const wmoSource: AlertSource = {
  id: "wmo",
  region: "Global (WMO SWIC)",
  pollIntervalSec: Number(process.env.WMO_POLL_SEC || 600),
  enabled: process.env.ALERTS_WMO_ENABLED !== "false",
  reconcile: true, // single WFS fetch = reliable full snapshot

  async fetch(): Promise<RawPayload[]> {
    const now = new Date().toISOString();
    const params = new URLSearchParams({
      service: "WFS",
      version: "1.1.0",
      request: "GetFeature",
      typeName: TYPENAME,
      outputFormat: "application/json",
      maxFeatures: String(process.env.WMO_MAX_FEATURES || 30000),
      // Currently-in-effect only: the layer holds the full archive (millions).
      CQL_FILTER: `expires >= ${now} AND sent <= ${now}`,
    });
    const res = await fetch(`${OWS}?${params.toString()}`, {
      headers: {
        "User-Agent": userAgent(),
        Referer: "https://severeweather.wmo.int/",
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`wmo fetch failed: ${res.status} ${res.statusText}`);
    return [
      {
        contentType: res.headers.get("content-type") ?? "application/json",
        body: await res.text(),
        fetchedAt: new Date().toISOString(),
      },
    ];
  },

  parse(raw: RawPayload[]): CapMessage[] {
    const exclude = excludeCC();
    const msgs: CapMessage[] = [];
    for (const payload of raw) {
      let fc: any;
      try {
        fc = JSON.parse(payload.body);
      } catch {
        continue;
      }
      const features = Array.isArray(fc?.features) ? fc.features : [];
      msgs.push(...featuresToCapMessages(features, exclude));
    }
    return msgs;
  },

  normalise(msgs: CapMessage[], now = new Date()) {
    return canonicaliseCapMessages(msgs, now);
  },
};
