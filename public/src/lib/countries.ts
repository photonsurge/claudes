"use client";

import { useEffect, useState } from "react";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import type { iCountryModel } from "@photonsurge/shared/db/country-model";
import type { iAreaWeatherReportModel } from "@photonsurge/shared/db/area-weather-report-model";

export interface CountryWithWeather extends iCountryModel {
  weather: iAreaWeatherReportModel | null;
}

/** One country plus its latest area-weather snapshot and recent history — the /countries/[id] payload. */
export interface CountryDetail {
  country: iCountryModel;
  weather: iAreaWeatherReportModel | null;
  history: iAreaWeatherReportModel[];
}

const EMPTY: CountryWithWeather[] = [];

/** ISO 3166-1 alpha-2 → flag emoji (regional-indicator Unicode trick) — computed on the fly, never stored. */
export function flagEmoji(iso2?: string): string {
  if (!iso2 || iso2.length !== 2) return "🏳️";
  return String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

/** Enrichment status label + colour for a country — mirrors `cityEnrichmentStatus`. */
export function countryEnrichmentStatus(c: Pick<iCountryModel, "wikiTitle" | "wikiThumb" | "wikiExtract" | "wikiFetchedAt">): { label: string; color: string } {
  if (c.wikiTitle || c.wikiThumb || c.wikiExtract) return { label: "Enriched", color: "#34d399" };
  if (c.wikiFetchedAt) return { label: "Checked — no match", color: "#fbbf24" };
  return { label: "Not enriched", color: "#8b95a7" };
}

/** Plain fetch of the worker-seeded country catalog, each with its latest area-weather report inlined. */
export async function listCountries(): Promise<CountryWithWeather[]> {
  const res = await fetch("/api/countries", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  return body?.countries ?? [];
}

/** Fetch one full country record (+ area-weather history) for its dedicated details page. */
export async function getCountry(id: string): Promise<{ detail?: CountryDetail; error?: string }> {
  try {
    const res = await fetch(`/api/countries/${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.country) return { error: body?.error ?? `HTTP ${res.status}` };
    return { detail: { country: body.country, weather: body.weather ?? null, history: body.history ?? [] } };
  } catch (error) {
    return { error: String(error) };
  }
}

/** Toggle a country's 12h AI round-up opt-in. Returns true on success. */
export async function setCountryRoundup(countryId: string, roundupEnabled: boolean): Promise<boolean> {
  try {
    const res = await fetch(`/api/countries/${encodeURIComponent(countryId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundupEnabled }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** An enriched country minus its heavy boundary geometry — the /api/countries/at payload. */
export type CountryAt = Omit<iCountryModel, "geometry">;

/** The enriched country whose real boundary contains [lng,lat], or null over
 *  ocean / outside every country. Backs the round-up's per-stop "the place" card. */
export async function getCountryAt(lng: number, lat: number): Promise<CountryAt | null> {
  try {
    const res = await fetch(`/api/countries/at?lng=${lng}&lat=${lat}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    return body?.country ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the enriched country under a moving camera centre (the round-up tour
 * parks on a fresh hotspot each stop). `center` null → no lookup, returns null.
 * Rounds the coordinate before firing so the in-flight camera interpolation
 * doesn't spam the point-in-polygon route on every frame — only a settled stop
 * (a meaningfully different point) triggers a fetch.
 */
export function useCountryAt(center: [number, number] | null): CountryAt | null {
  const [country, setCountry] = useState<CountryAt | null>(null);
  const key = center ? `${center[0].toFixed(0)},${center[1].toFixed(0)}` : null;

  useEffect(() => {
    // Clear on EVERY key change (not just key→null) so the panel never shows the
    // PREVIOUS location's country while the new point resolves — that stale hold
    // is the on-air "shows previous country / shows on US" flash. `key` is rounded
    // to 0dp, so only a real move (a new cut/stop) changes it; blanking then is
    // correct because the old value is genuinely wrong for the new location.
    setCountry(null);
    if (!key) return;
    let cancelled = false;
    const [lng, lat] = key.split(",").map(Number);
    getCountryAt(lng, lat).then((c) => {
      if (!cancelled) setCountry(c);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return country;
}

/**
 * Poll the Country catalog for the admin table. The seed/enrich/area-weather
 * jobs all emit TRACKS_UPDATED (kind:"countries") on completion, so the table
 * refetches the instant a run lands; the interval is a fallback. Mirrors
 * `useVolcanoes` (public/src/lib/volcanoes-overlay.ts).
 */
export function useCountries(enabled = true): CountryWithWeather[] {
  const [countries, setCountries] = useState<CountryWithWeather[]>(EMPTY);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "countries") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setCountries(EMPTY);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const cs = await listCountries();
        if (!cancelled) setCountries(cs);
      } catch {
        /* leave previous data in place on a transient fetch error */
      }
    };
    poll();
    const iv = setInterval(poll, 120000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [enabled, liveTick]);

  return countries;
}
