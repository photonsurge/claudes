import type { Job } from "bullmq";
import { getAppDb, type AppDb } from "@photonsurge/shared/db/index";
import type { PlaceRoundupRepo } from "@photonsurge/shared/db/place-roundup-repo";
import { PLACE_ROUNDUPS_UPDATED } from "@photonsurge/shared/control";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";
import { buildPlaceInputs, WINDOW_HOURS, type PlaceRef } from "../placeRoundups/aggregate";
import { generatePlaceNarrative } from "../placeRoundups/openrouter";

const TAG = "job:placeRoundups";

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
  return runBatch("country", places, db.countryRoundups, db);
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
  return runBatch("region", places, db.regionRoundups, db);
}
