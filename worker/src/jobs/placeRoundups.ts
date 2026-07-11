import type { Job } from "bullmq";
import { getAppDb, type AppDb } from "@photonsurge/shared/db/index";
import type { PlaceRoundupRepo } from "@photonsurge/shared/db/place-roundup-repo";
import { PLACE_ROUNDUPS_UPDATED } from "@photonsurge/shared/control";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";
import { buildPlaceInputs, WINDOW_HOURS, type PlaceRef } from "../placeRoundups/aggregate";
import { isPlaceDue } from "../placeRoundups/localTime";
import { generatePlaceNarrative } from "../placeRoundups/openrouter";

const TAG = "job:placeRoundups";

/**
 * Keep only the places whose LOCAL time is currently in a target slot and that
 * haven't generated recently — so each place's round-up lands in its own morning
 * / evening rather than at a fixed UTC instant. `repo.latestPerPlace()` gives the
 * last generation time for every place in one round trip. Set
 * PLACE_ROUNDUP_IGNORE_LOCAL_TIME=true to bypass (generate the whole set, the old
 * behaviour — handy for a manual "generate now" of everything).
 */
async function filterDue(kind: "country" | "region", places: PlaceRef[], repo: PlaceRoundupRepo): Promise<PlaceRef[]> {
  if (process.env.PLACE_ROUNDUP_IGNORE_LOCAL_TIME === "true") return places;
  const latest = await repo.latestPerPlace();
  const lastGen = new Map(latest.map((r) => [r.placeId, new Date(r.generatedAt)]));
  const now = new Date();
  const due = places.filter((p) => isPlaceDue(now, p.bbox, lastGen.get(p.id) ?? null));
  log(TAG, `${kind} due this run`, { due: due.length, total: places.length });
  return due;
}

/**
 * Generate one round-up for a single place: build the place-scoped inputs, fetch
 * the PREVIOUS round-up (fed to the LLM for continuity), ask OpenRouter for a
 * narrative, and append the doc. Degrades gracefully — no API key still stores
 * the deterministic inputs. Returns a compact result for the run log.
 */
async function runForPlace(db: AppDb, repo: PlaceRoundupRepo, place: PlaceRef) {
  const prev = await repo.latestForPlace(place.id);
  const now = new Date();
  const inputs = await buildPlaceInputs(db, place);
  const narrative = await generatePlaceNarrative({ kind: place.kind, name: place.name }, inputs, prev);
  const saved = await repo.create({
    placeKind: place.kind,
    placeId: place.id,
    name: place.name,
    generatedAt: now,
    windowStart: new Date(now.getTime() - WINDOW_HOURS * 3_600_000).toISOString(),
    windowEnd: now.toISOString(),
    inputs,
    narrative: narrative.narrative,
    summary: narrative.summary,
    stateOfPlay: narrative.stateOfPlay,
    cityOutlook: narrative.cityOutlook,
    advice: narrative.advice,
    narrativeStatus: narrative.status,
    prevRoundupId: prev?.id,
    llm: {
      model: narrative.model,
      promptTokens: narrative.promptTokens,
      completionTokens: narrative.completionTokens,
      latencyMs: narrative.latencyMs,
      error: narrative.error,
    },
  });
  return {
    id: saved.id,
    place: place.name,
    cities: inputs.topCities.length,
    alerts: inputs.alerts.length,
    volcanoes: inputs.volcanoes.length,
    narrativeStatus: narrative.status,
  };
}

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
export async function generateCountries(_job: Job) {
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
  const due = await filterDue("country", places, db.countryRoundups);
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
export async function generateRegions(_job: Job) {
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
  const due = await filterDue("region", places, db.regionRoundups);
  return runBatch("region", due, db.regionRoundups, db);
}
