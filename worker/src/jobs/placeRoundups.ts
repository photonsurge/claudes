import type { Job } from "bullmq";
import { getAppDb, type AppDb } from "@photonsurge/shared/db/index";
import type { PlaceRoundupRepo } from "@photonsurge/shared/db/place-roundup-repo";
import { PLACE_ROUNDUPS_UPDATED } from "@photonsurge/shared/control";
import { ROUNDUP_ID_FOR_PLACE } from "@photonsurge/shared/roundup-settings";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";
import { freshEvents } from "../director/fresh";
import type { PlaceRef } from "../placeRoundups/aggregate";
import { isPlaceDue } from "../placeRoundups/localTime";
import { runForPlace } from "../placeRoundups/refresh";

const TAG = "job:placeRoundups";

/** A manual /admin trigger arrives as `data.data.trigger === "admin"`; the cron sends `{}`. */
function isManualTrigger(job: Job): boolean {
  return (job.data as { data?: { trigger?: string } } | undefined)?.data?.trigger === "admin";
}

/**
 * Keep only the places whose current LOCAL slot hasn't been served yet — so each
 * place's round-up lands in its own morning / evening rather than at a fixed UTC
 * instant. The slots (local hours) and the on/off switch per kind come from the
 * operator's round-up settings, read once per run so an edit applies at the next
 * hourly fire. `repo.latestPerPlace()` gives the last generation time for every
 * place in one round trip.
 *
 * Order matters. A manual "Generate now" click (/admin/place-roundups or
 * /admin/jobs) arrives with `trigger:"admin"` and gets the whole set — even when
 * the kind is switched off — because an operator clicking the button wants the
 * round-ups now, not "nothing, because it isn't 6am anywhere". Otherwise a
 * disabled kind generates nothing, PLACE_ROUNDUP_IGNORE_LOCAL_TIME=true forces
 * the whole set (incl. the cron) if ever needed, and the rest is the due filter.
 */
async function filterDue(
  kind: "country" | "region",
  places: PlaceRef[],
  repo: PlaceRoundupRepo,
  db: AppDb,
  manual: boolean,
): Promise<PlaceRef[]> {
  if (manual) return places;
  const setting = (await db.roundupSettings.get())[ROUNDUP_ID_FOR_PLACE[kind]];
  if (!setting.enabled) {
    log(TAG, `${kind} round-ups disabled in settings`);
    return [];
  }
  if (process.env.PLACE_ROUNDUP_IGNORE_LOCAL_TIME === "true") return places;
  const latest = await repo.latestPerPlace();
  const lastGen = new Map(latest.map((r) => [r.placeId, new Date(r.generatedAt)]));
  const now = new Date();
  const due = places.filter((p) => isPlaceDue(now, p.bbox, lastGen.get(p.id) ?? null, setting));
  log(TAG, `${kind} due this run`, { due: due.length, total: places.length });
  return due;
}

// One place's round-up: `runForPlace` lives in placeRoundups/refresh.ts (with
// the single-place entry the render queue's `refresh` uses), because the job
// loader registers every function exported from this file as a handler.

/** Loop a set of places, one round-up each, tolerating a single place's failure. */
async function runBatch(
  kind: "country" | "region",
  places: PlaceRef[],
  repo: PlaceRoundupRepo,
  db: AppDb,
): Promise<{ kind: string; places: number; ok: number }> {
  // Nothing due this hour (the common case now the schedule is local-time phased) —
  // return quietly rather than logging a 0/0 batch every run.
  if (!places.length) return { kind, places: 0, ok: 0 };
  let ok = 0;
  for (const place of places) {
    try {
      const result = await runForPlace(db, repo, place);
      ok += 1;
      log(TAG, `${kind} round-up done`, result);
      emitWorkerEvent({ type: PLACE_ROUNDUPS_UPDATED, data: { placeKind: kind, placeId: place.id, id: result.id } });
      freshEvents.nudge();
    } catch (err) {
      log(TAG, `${kind} round-up failed`, { place: place.name, err: summarizeForLog(err) });
      blogErr(TAG, `${kind} round-up failed: ${place.name}`, err, "placeRoundups", place.id);
    }
  }
  const summary = { kind, places: places.length, ok };
  blogInfo(TAG, `${kind} round-ups: ${ok}/${places.length}`, summary, "placeRoundups", kind);
  return summary;
}

/** Country round-ups — only the opt-in (`roundupEnabled`) countries. */
export async function generateCountries(job: Job) {
  const db = await getAppDb();
  const countries = await db.countries.listRoundupEnabled();
  const places: PlaceRef[] = countries.map((c) => ({
    kind: "country",
    id: c.countryId,
    name: c.name,
    bbox: c.bbox,
    geometry: c.geometry as PlaceRef["geometry"],
    iso2: c.iso2,
    capital: c.capital,
  }));
  const due = await filterDue("country", places, db.countryRoundups, db, isManualTrigger(job));
  return runBatch("country", due, db.countryRoundups, db);
}

/**
 * Region ids to skip — the whole-planet "world" framing region isn't a real
 * region: it grabs every global alert (thousands) and just duplicates the global
 * summary. Env-extendable (comma-separated regionIds).
 */
const EXCLUDED_REGION_IDS = new Set(
  ["world", ...(process.env.PLACE_ROUNDUP_EXCLUDE_REGIONS || "").split(",")]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

/** Region round-ups — every region except the whole-planet framing ones (bbox-scoped, no opt-in). */
export async function generateRegions(job: Job) {
  const db = await getAppDb();
  const regions = await db.regions.list();
  const places: PlaceRef[] = regions
    .filter((r) => !EXCLUDED_REGION_IDS.has(r.regionId.toLowerCase()))
    .map((r) => ({
      kind: "region",
      id: r.regionId,
      name: r.name,
      bbox: r.bbox,
    }));
  const due = await filterDue("region", places, db.regionRoundups, db, isManualTrigger(job));
  return runBatch("region", due, db.regionRoundups, db);
}
