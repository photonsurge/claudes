/**
 * Build the scored candidate pool the director picks from each cut. Live events
 * (earthquakes, severe-weather alerts, notable flights/ships) come from the same
 * Mongo caches the public overlays read; curated regions (ROIs + a global intro)
 * are always added as filler so the channel never runs out of somewhere to look.
 *
 * Pure-ish: takes a DB facade + config, returns Candidates. Scoring lives here
 * so "what's newsworthy" is one readable place to tune.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import type { DirectorConfig, Segment, SegmentKind } from "@photonsurge/shared/director";
import type { Candidate } from "@photonsurge/shared/director-select";
import {
  PRESETS,
  REGIONS_OF_INTEREST,
  GLOBAL_VIEW,
} from "@photonsurge/shared/director-rois";

/** Average all [lng,lat] pairs found anywhere in a GeoJSON coordinate tree. */
function geomCenter(geometry: unknown): [number, number] | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      sx += node[0] as number;
      sy += node[1] as number;
      n += 1;
      return;
    }
    for (const child of node) walk(child);
  };
  const coords = (geometry as { coordinates?: unknown } | null)?.coordinates;
  walk(coords);
  return n > 0 ? [sx / n, sy / n] : null;
}

const make = (
  kind: SegmentKind,
  subject: string,
  title: string,
  subtitle: string | undefined,
  center: [number, number],
  zoom: number,
  holdMs: number,
): Segment => ({
  id: `${kind}:${subject}`,
  kind,
  title,
  subtitle,
  camera: { center, zoom },
  patch: { ...PRESETS[kind], camera: { center, zoom } },
  holdMs,
});

/** Curated filler: one global intro spin + a rotation of regions of interest. */
function fillerCandidates(cfg: DirectorConfig, holdMs: number): Candidate[] {
  const out: Candidate[] = [];
  if (cfg.kinds.intro) {
    out.push({
      score: 6,
      segment: make("intro", "global", "Live Weather", undefined, GLOBAL_VIEW.center, GLOBAL_VIEW.zoom, Math.round(holdMs * 1.4)),
    });
  }
  if (cfg.kinds.tour) {
    for (const roi of REGIONS_OF_INTEREST) {
      out.push({ score: 5, segment: make("tour", roi.id, roi.name, "Regional weather", roi.center, roi.zoom, holdMs) });
    }
  }
  return out;
}

export async function buildCandidates(db: AppDb, cfg: DirectorConfig): Promise<Candidate[]> {
  const holdMs = Math.round(cfg.holdSeconds * 1000);
  const pool: Candidate[] = fillerCandidates(cfg, holdMs);

  // --- Earthquakes: magnitude is the headline; recent + big ranks highest. ---
  if (cfg.kinds.quake) {
    try {
      const quakes = await db.quakes.list({ minMag: cfg.minQuakeMag, limit: 40 });
      for (const q of quakes) {
        const subtitle = `M${q.mag.toFixed(1)}${q.place ? ` · ${q.place}` : ""}`;
        pool.push({
          score: 40 + q.mag * 10,
          segment: make("quake", q.quakeId, q.tsunami ? "Earthquake · Tsunami" : "Earthquake", subtitle, [q.lng, q.lat], 5, holdMs),
        });
      }
    } catch {
      /* no quakes cached yet — fillers carry the show */
    }
  }

  // --- Severe weather: normalised severity ranks; centroid from the polygon. ---
  if (cfg.kinds.storm) {
    try {
      const alerts = await db.alerts.list({ activeOnly: true, severityMin: cfg.minAlertSeverity, limit: 40 });
      for (const a of alerts as any[]) {
        const info = Array.isArray(a.info) ? a.info[0] : undefined;
        const area = info?.area?.[0];
        const center = geomCenter(area?.geometry);
        if (!center) continue; // geocode-only alert (no polygon) — can't frame it
        const sev = typeof a.maxSeverityRank === "number" ? a.maxSeverityRank : info?.severityRank ?? 0;
        pool.push({
          score: 50 + sev * 12,
          segment: make("storm", `${a.source}:${a.identifier}`, info?.event || "Weather Warning", area?.areaDesc, center, 4.5, holdMs),
        });
      }
    } catch {
      /* alerts not ingested — skip */
    }
  }

  // --- Notable aircraft: highest cruising jets in the latest frame. ---
  if (cfg.kinds.flight) {
    try {
      const { rows } = await db.trackSnapshots.latest({ kind: "aircraft" });
      const notable = rows
        .filter((r) => typeof r.altM === "number" && (r.altM as number) > 9000)
        .sort((x, y) => (y.altM as number) - (x.altM as number))
        .slice(0, 6);
      for (const r of notable) {
        const name = r.name?.trim() || r.externalId.toUpperCase();
        const altKft = Math.round(((r.altM as number) * 3.281) / 100) / 10;
        pool.push({
          score: 18,
          segment: make("flight", r.externalId, name, `Aircraft · FL${Math.round(altKft * 10)}`, [r.lng, r.lat], 6, holdMs),
        });
      }
    } catch {
      /* no aircraft frame — skip */
    }
  }

  // --- Notable ships: the fastest movers in the latest frame. ---
  if (cfg.kinds.ship) {
    try {
      const { rows } = await db.trackSnapshots.latest({ kind: "ship" });
      const notable = rows
        .filter((r) => typeof r.speed === "number" && (r.speed as number) > 12)
        .sort((x, y) => (y.speed as number) - (x.speed as number))
        .slice(0, 4);
      for (const r of notable) {
        const name = r.name?.trim() || `MMSI ${r.externalId}`;
        pool.push({
          score: 14,
          segment: make("ship", r.externalId, name, `Vessel · ${Math.round(r.speed as number)} kn`, [r.lng, r.lat], 6.5, holdMs),
        });
      }
    } catch {
      /* no ship frame — skip */
    }
  }

  return pool;
}
