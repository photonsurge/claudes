"use client";

/**
 * One rotation-list poll for every placed-IMAGE sponsor surface (the
 * bottom-left billboard, the New alerts card): a light poll of the surface's
 * public route (lean wire shape, media served separately), refreshed every
 * few minutes so an operator (de)activating a creative reaches air without a
 * reload; failures keep the last good list (a blip never blanks a slot
 * mid-rotation).
 */
import { useEffect, useState } from "react";
import type { BillboardAd } from "@photonsurge/shared/ads/billboard";

const REFRESH_MS = 5 * 60 * 1000;

/** Null = the fetch failed (keep what we have); [] = genuinely nothing placed. */
export async function getPlacedAds(url: string): Promise<BillboardAd[] | null> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body?.ads)) return null;
  return (body.ads as unknown[]).filter(
    (a): a is BillboardAd =>
      typeof (a as BillboardAd)?.adId === "string" &&
      typeof (a as BillboardAd)?.mediaUrl === "string",
  );
}

export function usePlacedAds(url: string): BillboardAd[] {
  const [ads, setAds] = useState<BillboardAd[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getPlacedAds(url)
        .then((a) => {
          if (!cancelled && a) setAds(a);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [url]);

  return ads;
}
