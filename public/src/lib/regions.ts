"use client";

import { useEffect, useState } from "react";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import type { iRegionModel } from "@photonsurge/shared/db/region-model";
import type { iAreaWeatherReportModel } from "@photonsurge/shared/db/area-weather-report-model";
import type { RegionActivity } from "@photonsurge/shared/region-activity";

export interface RegionWithWeather extends iRegionModel {
  weather: iAreaWeatherReportModel | null;
}

/** One region plus its latest area-weather snapshot and recent history — the /regions/[id] payload. */
export interface RegionDetail {
  region: iRegionModel;
  weather: iAreaWeatherReportModel | null;
  history: iAreaWeatherReportModel[];
  /** Live alerts/seismic/volcanic within the region (null for oceans). */
  activity: RegionActivity | null;
}

const EMPTY: RegionWithWeather[] = [];

/** Enrichment status label + colour for a region — mirrors `countryEnrichmentStatus`. */
export function regionEnrichmentStatus(r: Pick<iRegionModel, "wikiTitle" | "wikiThumb" | "wikiExtract" | "wikiFetchedAt">): { label: string; color: string } {
  if (r.wikiTitle || r.wikiThumb || r.wikiExtract) return { label: "Enriched", color: "#34d399" };
  if (r.wikiFetchedAt) return { label: "Checked — no match", color: "#fbbf24" };
  return { label: "Not enriched", color: "#8b95a7" };
}

/** Plain fetch of the worker-seeded region catalog, each with its latest area-weather report inlined. */
export async function listRegions(): Promise<RegionWithWeather[]> {
  const res = await fetch("/api/regions", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  return body?.regions ?? [];
}

/** Fetch one full region record (+ area-weather history) for its dedicated details page. */
export async function getRegion(id: string): Promise<{ detail?: RegionDetail; error?: string }> {
  try {
    const res = await fetch(`/api/regions/${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.region) return { error: body?.error ?? `HTTP ${res.status}` };
    return { detail: { region: body.region, weather: body.weather ?? null, history: body.history ?? [], activity: body.activity ?? null } };
  } catch (error) {
    return { error: String(error) };
  }
}

/** Poll the Region catalog for the admin table. Mirrors `useCountries`. */
export function useRegions(enabled = true): RegionWithWeather[] {
  const [regions, setRegions] = useState<RegionWithWeather[]>(EMPTY);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "regions") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setRegions(EMPTY);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const rs = await listRegions();
        if (!cancelled) setRegions(rs);
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

  return regions;
}
