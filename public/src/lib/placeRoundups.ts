/**
 * Client helpers + types for the per-place AI round-ups. The admin screen reads
 * the index + history from /api/admin/place-roundups; the broadcast frame polls a
 * single place's latest from the public /api/roundup/place. Re-exports the shared
 * model shapes so callers have one import for both.
 */
import { useEffect, useState } from "react";

export type {
  PlaceRoundupKind,
  RoundupNarrativeStatus,
  iPlaceRoundupModel as PlaceRoundup,
  iPlaceRoundupInputs as PlaceRoundupInputs,
  iRoundupCity as RoundupCity,
  iRoundupCityOutlook as RoundupCityOutlook,
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

/** Just the latest round-up for one place, from the public broadcast endpoint —
 *  the region-mode deck slide (no history/index). Null when the place has none. */
export async function getLatestPlaceRoundup(
  kind: PlaceRoundupKind,
  placeId: string,
): Promise<iPlaceRoundupModel | null> {
  const res = await fetch(`/api/roundup/place?kind=${kind}&placeId=${encodeURIComponent(placeId)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`place round-up fetch failed: ${res.status}`);
  const body = (await res.json()) as { latest: iPlaceRoundupModel | null };
  return body.latest;
}

/** Poll one place's latest round-up so a country/region shot carries its current
 *  narrative + stats. Place round-ups regenerate on a 12h cadence, so a 5-minute
 *  refresh is plenty; `placeId` null (off a region shot) clears + skips fetching. */
export function useLatestPlaceRoundup(
  kind: PlaceRoundupKind,
  placeId: string | null,
): iPlaceRoundupModel | null {
  const [roundup, setRoundup] = useState<iPlaceRoundupModel | null>(null);

  useEffect(() => {
    // Clear on EVERY place change so a country/region shot never shows the
    // PREVIOUS place's round-up while the new one loads (same stale-hold fix as
    // useCountryAt / useRegion).
    setRoundup(null);
    if (!placeId) return;
    let cancelled = false;
    const load = () =>
      getLatestPlaceRoundup(kind, placeId)
        .then((r) => {
          if (!cancelled) setRoundup(r);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [kind, placeId]);

  return roundup;
}

/** Kind tabs — each maps to the job that generates it, for the "Generate now" button. */
export const PLACE_ROUNDUP_KINDS: { id: PlaceRoundupKind; label: string; jobId: string }[] = [
  { id: "country", label: "Countries", jobId: "place-roundups-countries" },
  { id: "region", label: "Regions", jobId: "place-roundups-regions" },
];
