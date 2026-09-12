"use client";

/** The bottom-left sponsor billboard's rotation list — see use-placed-ads. */
import type { BillboardAd } from "@photonsurge/shared/ads/billboard";
import { getPlacedAds, usePlacedAds } from "./use-placed-ads";

const BILLBOARD_ADS_URL = "/api/ads/billboard";

export function getBillboardAds(): Promise<BillboardAd[] | null> {
  return getPlacedAds(BILLBOARD_ADS_URL);
}

export function useBillboardAds(): BillboardAd[] {
  return usePlacedAds(BILLBOARD_ADS_URL);
}
