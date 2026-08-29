"use client";

/**
 * The bottom-left sponsor billboard's rotation list — a light poll of
 * /api/ads/billboard (lean wire shape, media served separately). Refreshes
 * every few minutes so an operator (de)activating a creative reaches air
 * without a reload; failures keep the last good list (a blip never blanks
 * the corner mid-rotation).
 */
import { useEffect, useState } from "react";
import type { BillboardAd } from "@photonsurge/shared/ads/billboard";

const REFRESH_MS = 5 * 60 * 1000;

/** Null = the fetch failed (keep what we have); [] = genuinely nothing placed. */
export async function getBillboardAds(): Promise<BillboardAd[] | null> {
  const res = await fetch("/api/ads/billboard", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body?.ads)) return null;
  return (body.ads as unknown[]).filter(
    (a): a is BillboardAd =>
      typeof (a as BillboardAd)?.adId === "string" &&
      typeof (a as BillboardAd)?.mediaUrl === "string",
  );
}

export function useBillboardAds(): BillboardAd[] {
  const [ads, setAds] = useState<BillboardAd[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getBillboardAds()
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
  }, []);

  return ads;
}
