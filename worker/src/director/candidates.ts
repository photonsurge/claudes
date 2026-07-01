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
  OCEAN_VIEW_ZOOM,
  OCEAN_VIEWS,
  ORBITAL_VIEW_ZOOM,
  ORBITAL_VIEWS,
} from "@photonsurge/shared/director-rois";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import { hazardMapPlan } from "@photonsurge/shared/alerts/hazard-director";
import { quakeSegmentContent, alertSegmentContent } from "@photonsurge/shared/segments";
import { tleGroups } from "../jobs/tracks";

const make = (
  kind: SegmentKind,
  subject: string,
  title: string,
  subtitle: string | undefined,
  center: [number, number],
  zoom: number,
  holdMs: number,
  /** Extra per-segment ControlState (e.g. ocean shots set their own variable). */
  extra?: Partial<Segment["patch"]>,
): Segment => ({
  id: `${kind}:${subject}`,
  kind,
  title,
  subtitle,
  camera: { center, zoom },
  patch: { ...PRESETS[kind], ...extra, camera: { center, zoom } },
  holdMs,
});

type Detail = { label: string; value: string };

/** Curated filler: one global intro spin + a rotation of regions of interest. */
function fillerCandidates(cfg: DirectorConfig, holdMs: number): Candidate[] {
  const out: Candidate[] = [];
  if (cfg.kinds.intro) {
    out.push({
      score: 6,
      segment: make("intro", "global", "Global Weather", undefined, GLOBAL_VIEW.center, GLOBAL_VIEW.zoom, Math.round(holdMs * 1.4)),
    });
  }
  if (cfg.kinds.ocean) {
    // Global ocean spins — one per ocean variable (SST, waves); the segment
    // asserts its own activeVariable over the shared ocean preset.
    for (const view of OCEAN_VIEWS) {
      out.push({
        score: 6,
        segment: make(
          "ocean",
          view.id,
          view.title,
          view.subtitle,
          GLOBAL_VIEW.center,
          OCEAN_VIEW_ZOOM,
          Math.round(holdMs * 1.4),
          { activeVariable: view.variable },
        ),
      });
    }
  }
  if (cfg.kinds.orbital) {
    // Only air constellations whose TLEs the worker actually ingests
    // (SATELLITE_GROUPS), so an orbital shot is never empty.
    const ingested = new Set(tleGroups());
    for (const view of ORBITAL_VIEWS) {
      if (!ingested.has(view.group)) continue;
      out.push({
        score: 6,
        segment: make(
          "orbital",
          view.group,
          view.title,
          view.subtitle,
          GLOBAL_VIEW.center,
          view.zoom ?? ORBITAL_VIEW_ZOOM,
          Math.round(holdMs * 1.4),
          { satelliteGroup: view.group },
        ),
      });
    }
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
        const c = quakeSegmentContent({
          mag: q.mag,
          place: q.place,
          depthKm: q.depthKm,
          timeMs: q.time ? q.time.getTime() : undefined,
          tsunami: q.tsunami,
        });
        const seg = make("quake", q.quakeId, c.title, c.subtitle, [q.lng, q.lat], 5, holdMs);
        seg.details = c.details;
        pool.push({ score: 40 + q.mag * 10, segment: seg });
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
        const center = alertRepPoint(area?.geometry);
        if (!center) continue; // geocode-only alert (no polygon) — can't frame it
        const sev = typeof a.maxSeverityRank === "number" ? a.maxSeverityRank : info?.severityRank ?? 0;
        const sinceIso = info?.onset ?? info?.effective ?? a.sent;
        const sinceMs = sinceIso ? Date.parse(sinceIso) : NaN;
        const hazard = classifyHazard({ event: info?.event, parameters: info?.parameters });
        // The hazard drives which maps the shot cycles and how long it holds:
        // open on the plan's first field and stretch the hold for slow hazards.
        const plan = hazardMapPlan(hazard);
        // Same classification/labels the map badge/legend + click-to-select card
        // use — subtitle leads with place then country ("Brest Region · 🇧🇾 Belarus").
        const c = alertSegmentContent({
          source: String(a.source),
          identifier: String(a.identifier),
          event: info?.event,
          severityRank: sev,
          level: info?.sourceSeverity,
          areaDesc: area?.areaDesc,
          hazard,
          center,
          sinceMs: Number.isNaN(sinceMs) ? undefined : sinceMs,
        });
        const seg = make("storm", `${a.source}:${a.identifier}`, c.title, c.subtitle, center, 4.5, Math.round(holdMs * plan.holdScale), {
          activeVariable: plan.cycle[0],
        });
        seg.hazard = hazard;
        seg.icon = c.icon;
        seg.details = c.details;
        pool.push({ score: 50 + sev * 12, segment: seg });
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
        const seg = make("flight", r.externalId, name, `Aircraft · FL${Math.round(altKft * 10)}`, [r.lng, r.lat], 6, holdMs);
        const details: Detail[] = [{ label: "Altitude", value: `FL${Math.round(altKft * 10)} · ${Math.round(r.altM as number).toLocaleString()} m` }];
        if (typeof r.headingDeg === "number") details.push({ label: "Heading", value: `${Math.round(r.headingDeg)}°` });
        seg.details = details;
        pool.push({ score: 18, segment: seg });
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
        const seg = make("ship", r.externalId, name, `Vessel · ${Math.round(r.speed as number)} kn`, [r.lng, r.lat], 6.5, holdMs);
        const details: Detail[] = [{ label: "Speed", value: `${Math.round(r.speed as number)} kn` }];
        if (typeof r.headingDeg === "number") details.push({ label: "Course", value: `${Math.round(r.headingDeg)}°` });
        seg.details = details;
        pool.push({ score: 14, segment: seg });
      }
    } catch {
      /* no ship frame — skip */
    }
  }

  return pool;
}
