"use client";

/**
 * Channel READING-PACE context — the characters-per-second every scrolling
 * surface on /watch sizes itself from (bottom crawl, WORLD REPORT row marquee,
 * deck card bodies). WatchSurface provides `ControlState.readPaceCps` here so
 * deeply-nested chrome doesn't have to thread a pace prop through every layer,
 * exactly as theme-context does for the channel brand.
 *
 * The maths lives in shared/reading-pace (each surface derives its own motion
 * from its own content length); this is only the wire.
 */
import { createContext, useContext } from "react";
import { clampReadCps, DEFAULT_READ_CPS } from "@photonsurge/shared/reading-pace";

/** Resolved channel pace, cps. Null outside a provider (admin previews, tests). */
export const ReadPaceContext = createContext<number | null>(null);

/** Resolution order: explicit prop > provider > the shared default. */
export function useReadPace(propCps?: number): number {
  const ctx = useContext(ReadPaceContext);
  return clampReadCps(propCps ?? ctx ?? DEFAULT_READ_CPS);
}
