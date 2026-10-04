/**
 * One place's round-up, written now. `runForPlace` is the body of the place
 * round-up job (jobs/placeRoundups.ts loops it over the places that are due);
 * `refreshPlaceRoundup` is the single-place entry point the render queue calls
 * when a scheduled video's round-up is older than its rule allows
 * (docs/short-video-plan.md §8, `ifStale: "refresh"`): one LLM call.
 *
 * Lives here, not in jobs/placeRoundups.ts: the job loader registers EVERY
 * function a jobs/*.ts file exports as a job handler, so that file exports
 * handlers only.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import type { PlaceRoundupRepo } from "@photonsurge/shared/db/place-roundup-repo";
import { PLACE_ROUNDUPS_UPDATED } from "@photonsurge/shared/control";
import { countryShot } from "@photonsurge/shared/director-countries";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { freshEvents } from "../director/fresh";
import { buildPlaceInputs, WINDOW_HOURS, type PlaceRef } from "./aggregate";
import { generatePlaceNarrative } from "./openrouter";

const TAG = "placeRoundups:refresh";

/**
 * Generate one round-up for a single place: build the place-scoped inputs, fetch
 * the PREVIOUS round-up (fed to the LLM for continuity), ask OpenRouter for a
 * narrative, and append the doc. Degrades gracefully — no API key still stores
 * the deterministic inputs. Returns a compact result for the run log.
 */
export async function runForPlace(db: AppDb, repo: PlaceRoundupRepo, place: PlaceRef) {
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
    error: narrative.error,
  };
}

/** A short video's place: a country (COUNTRY_SHOTS id) or an area (REGION_SHOTS id = regionId). */
export interface RoundupPlaceScope {
  type: "country" | "area";
  id: string;
}

/** The PlaceRef the round-up job would use for this scope, or a readable error. */
async function placeRefFor(db: AppDb, scope: RoundupPlaceScope): Promise<PlaceRef> {
  if (scope.type === "country") {
    const shot = countryShot(scope.id);
    if (!shot) throw new Error(`unknown country id "${scope.id}"`);
    const c = await db.countries.get(shot.iso2.toLowerCase());
    if (!c) throw new Error(`no country record for ${shot.name} — run the countries job`);
    return {
      kind: "country",
      id: c.countryId,
      name: c.name,
      bbox: c.bbox,
      geometry: c.geometry as PlaceRef["geometry"],
      iso2: c.iso2,
      capital: c.capital,
    };
  }
  const r = await db.regions.get(scope.id);
  if (!r) throw new Error(`no region record for "${scope.id}" — run the regions job`);
  return { kind: "region", id: r.regionId, name: r.name, bbox: r.bbox };
}

/**
 * Write a fresh round-up for one place now — the single-place entry point.
 * Works whether or not the kind is switched on in the round-up settings (an
 * operator's schedule asked for it). Throws with a readable reason when the
 * place is unknown or no narrative came back (no API key, an LLM error), so
 * the caller can fail the video with it.
 */
export async function refreshPlaceRoundup(db: AppDb, scope: RoundupPlaceScope) {
  const place = await placeRefFor(db, scope);
  const repo = place.kind === "country" ? db.countryRoundups : db.regionRoundups;
  const result = await runForPlace(db, repo, place);
  log(TAG, `${place.kind} round-up refreshed`, result);
  emitWorkerEvent({ type: PLACE_ROUNDUPS_UPDATED, data: { placeKind: place.kind, placeId: place.id, id: result.id } });
  freshEvents.nudge();
  if (result.narrativeStatus !== "ok") {
    throw new Error(
      `the refreshed round-up for ${place.name} has no narrative (${result.narrativeStatus}${result.error ? `: ${result.error}` : ""})`,
    );
  }
  return result;
}
