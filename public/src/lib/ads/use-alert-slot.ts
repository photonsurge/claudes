"use client";

/** The New alerts card's sponsor rotation list — see use-placed-ads. */
import type { AlertSlotAd } from "@photonsurge/shared/ads/alert-slot";
import { usePlacedAds } from "./use-placed-ads";

const ALERT_SLOT_ADS_URL = "/api/ads/alert-slot";

export function useAlertSlotAds(): AlertSlotAd[] {
  return usePlacedAds(ALERT_SLOT_ADS_URL);
}
