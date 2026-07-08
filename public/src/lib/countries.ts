"use client";

import { useEffect, useState } from "react";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import type { iCountryModel } from "@photonsurge/shared/db/country-model";
import type { iAreaWeatherReportModel } from "@photonsurge/shared/db/area-weather-report-model";

export interface CountryWithWeather extends iCountryModel {
  weather: iAreaWeatherReportModel | null;
}

const EMPTY: CountryWithWeather[] = [];

/** ISO 3166-1 alpha-2 → flag emoji (regional-indicator Unicode trick) — computed on the fly, never stored. */
export function flagEmoji(iso2?: string): string {
  if (!iso2 || iso2.length !== 2) return "🏳️";
  return String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

/** Plain fetch of the worker-seeded country catalog, each with its latest area-weather report inlined. */
export async function listCountries(): Promise<CountryWithWeather[]> {
  const res = await fetch("/api/countries", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  return body?.countries ?? [];
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
