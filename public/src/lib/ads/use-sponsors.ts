"use client";

/**
 * The active sponsor names for the on-air ticker mentions — a light poll of
 * /api/ads/sponsors (names only, no media). Refreshes every few minutes so an
 * operator (de)activating an ad reaches air without a reload; failures keep
 * the last good list (a blip never strips sponsors mid-crawl).
 */
import { useEffect, useState } from "react";

const REFRESH_MS = 5 * 60 * 1000;

/** Null = the fetch failed (keep what we have); [] = genuinely no active sponsors. */
export async function getSponsors(): Promise<string[] | null> {
  const res = await fetch("/api/ads/sponsors", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body?.sponsors)) return null;
  return (body.sponsors as unknown[]).filter((s): s is string => typeof s === "string");
}

export function useSponsors(): string[] {
  const [sponsors, setSponsors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getSponsors()
        .then((s) => {
          if (!cancelled && s) setSponsors(s);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return sponsors;
}
