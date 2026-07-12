/**
 * weatherPanels — precompute the on-air weather PANELS (point + area history)
 * for every catalog COUNTRY and REGION the director spotlights, and cache them
 * in Redis (see @photonsurge/shared/weather/panels). `public`'s focus composer
 * reads the finished series instead of sharp-decoding weather-grid PNGs at
 * request time — which was fanning the Next.js process across every core and
 * inflating its RSS.
 *
 * Efficiency: every archived frame is decoded AT MOST ONCE per refresh and
 * sampled for all entities that need it (buildEntityPanels), NOT per-entity.
 * Redis is the only store — a disposable, TTL-evicted copy of the SAMPLED
 * result; a cold Redis just means `public` composes live until the next tick.
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import {
  setWeatherPanel,
  BROADCAST_HISTORY_VARS,
  HISTORY_WINDOW_HOURS,
  type PanelScope,
} from "@photonsurge/shared/weather/panels";
import { buildEntityPanels, type PanelEntity } from "../weather/samplePanels";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";

const TAG = "job:weatherPanels";

/** How long a written panel lives — comfortably longer than the refresh cadence
 *  so entries never expire between runs (fail-open regardless). */
const PANEL_TTL_SEC = Number(process.env.WEATHER_PANEL_TTL_SEC || 10_800);

/** The live composer's max area framing (bboxForCamera clamps lngSpan≤120, so
 *  latSpan≤60). Clamping each entity's area bbox to this bounds the per-frame
 *  pixel scan for continent-sized countries AND roughly matches the camera. */
const MAX_LNG_SPAN = 120;
const MAX_LAT_SPAN = 60;

const wrapLng = (l: number): number => ((l + 540) % 360) - 180;

/** bbox centre, wrapping the antimeridian. */
function bboxCenter(bbox: [number, number, number, number]): [number, number] {
  const lat = (bbox[1] + bbox[3]) / 2;
  let lng = (bbox[0] + bbox[2]) / 2;
  if (bbox[2] < bbox[0]) lng = wrapLng((bbox[0] + bbox[2] + 360) / 2);
  return [lng, lat];
}

/** Clamp an entity bbox to the max framing around its centre. */
function clampArea(bbox: [number, number, number, number]): [number, number, number, number] {
  const [clng, clat] = bboxCenter(bbox);
  let width = bbox[2] - bbox[0];
  if (width < 0) width += 360; // antimeridian-wrapping bbox
  const w2 = Math.min(width, MAX_LNG_SPAN) / 2;
  const h2 = Math.min(Math.max(bbox[3] - bbox[1], 0), MAX_LAT_SPAN) / 2;
  return [wrapLng(clng - w2), Math.max(-90, clat - h2), wrapLng(clng + w2), Math.min(90, clat + h2)];
}

interface PanelSpec {
  scope: PanelScope;
  entityId: string;
  /** representative sample point */
  lat: number;
  lng: number;
  /** clamped area bbox */
  bbox: [number, number, number, number];
}

const hasBbox = (b: unknown): b is [number, number, number, number] =>
  Array.isArray(b) && b.length === 4 && b.every((n) => Number.isFinite(n));

export async function runWeatherPanels(): Promise<{ countries: number; regions: number; variables: number }> {
  const db = await getAppDb();

  // Only precompute the variables that (a) the panels chart and (b) actually
  // exist in the archive — mirrors the public composer's broadcast breadth-gate.
  const available = new Set(await db.weatherFrames.variables());
  const variables = BROADCAST_HISTORY_VARS.filter((v) => available.has(v));
  if (!variables.length) {
    log(TAG, "no charted variables in the archive yet — skipping");
    return { countries: 0, regions: 0, variables: 0 };
  }

  const specs: PanelSpec[] = [];

  for (const c of await db.countries.list()) {
    if (!hasBbox(c.bbox)) continue;
    const [clng, clat] = bboxCenter(c.bbox);
    specs.push({ scope: "country", entityId: c.countryId, lat: clat, lng: clng, bbox: clampArea(c.bbox) });
  }
  const countryCount = specs.length;

  for (const r of await db.regions.list()) {
    if (!hasBbox(r.bbox)) continue;
    const top = r.topCities?.[0];
    const [clng, clat] = top ? [top.lng, top.lat] : bboxCenter(r.bbox);
    specs.push({ scope: "region", entityId: r.regionId, lat: clat, lng: clng, bbox: clampArea(r.bbox) });
  }
  const regionCount = specs.length - countryCount;

  if (!specs.length) {
    log(TAG, "no country/region catalog yet — seed countries/regions first");
    return { countries: 0, regions: 0, variables: variables.length };
  }

  // Opaque index ids keep the decode-once map collision-free across scopes.
  const entities: PanelEntity[] = specs.map((s, i) => ({ id: String(i), lat: s.lat, lng: s.lng, bbox: s.bbox }));
  const from = new Date(Date.now() - HISTORY_WINDOW_HOURS * 3_600_000);

  const panels = await buildEntityPanels(db, entities, variables, from);

  const now = Date.now();
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const p = panels.get(String(i));
    if (!p) continue;
    await setWeatherPanel(
      {
        scope: s.scope,
        entityId: s.entityId,
        center: [s.lng, s.lat],
        bbox: s.bbox,
        windowHours: HISTORY_WINDOW_HOURS,
        pointHistory: p.pointHistory,
        areaHistory: p.areaHistory,
        generatedAt: now,
      },
      PANEL_TTL_SEC,
    );
  }

  const result = { countries: countryCount, regions: regionCount, variables: variables.length };
  log(TAG, "refresh done", result);
  blogInfo(
    TAG,
    `weather panels: ${countryCount} countries + ${regionCount} regions cached (${variables.length} vars)`,
    result,
    "weatherPanels",
    "refresh",
  );
  return result;
}

/** Job handler: `weatherPanels.refresh`. */
export async function refresh(_job: Job) {
  try {
    return await runWeatherPanels();
  } catch (err) {
    log(TAG, "refresh failed", summarizeForLog(err));
    blogErr(TAG, "weather panels refresh failed", err, "weatherPanels", "refresh");
    throw err;
  }
}
