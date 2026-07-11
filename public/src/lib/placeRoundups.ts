/**
 * Client helpers + types for the per-place AI round-ups admin screen. Fetches
 * from /api/admin/place-roundups; re-exports the shared model shapes so the page
 * has one import for both.
 */
export type {
  PlaceRoundupKind,
  RoundupNarrativeStatus,
  iPlaceRoundupModel as PlaceRoundup,
  iPlaceRoundupInputs as PlaceRoundupInputs,
  iRoundupCity as RoundupCity,
  iRoundupAlert as RoundupAlert,
  iRoundupVolcano as RoundupVolcano,
  iRoundupGauge as RoundupGauge,
  iRoundupAreaStat as RoundupAreaStat,
} from "@photonsurge/shared/db/place-roundup-model";

import type { PlaceRoundupKind, iPlaceRoundupModel } from "@photonsurge/shared/db/place-roundup-model";

export interface PlaceIndexResponse {
  kind: PlaceRoundupKind;
  places: iPlaceRoundupModel[];
}

export interface PlaceDetailResponse {
  kind: PlaceRoundupKind;
  placeId: string;
  latest: iPlaceRoundupModel | null;
  history: iPlaceRoundupModel[];
}

/** Latest round-up per place for a kind — the index list. */
export async function getPlaceRoundups(kind: PlaceRoundupKind): Promise<PlaceIndexResponse> {
  const res = await fetch(`/api/admin/place-roundups?kind=${kind}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`place round-ups fetch failed: ${res.status}`);
  return res.json();
}

/** One place's latest round-up + recent history. */
export async function getPlaceRoundupDetail(
  kind: PlaceRoundupKind,
  placeId: string,
  history = 20,
): Promise<PlaceDetailResponse> {
  const res = await fetch(
    `/api/admin/place-roundups?kind=${kind}&placeId=${encodeURIComponent(placeId)}&history=${history}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`place round-up detail fetch failed: ${res.status}`);
  return res.json();
}

/** Kind tabs — each maps to the job that generates it, for the "Generate now" button. */
export const PLACE_ROUNDUP_KINDS: { id: PlaceRoundupKind; label: string; jobId: string }[] = [
  { id: "country", label: "Countries", jobId: "place-roundups-countries" },
  { id: "region", label: "Regions", jobId: "place-roundups-regions" },
];
