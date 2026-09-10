"use client";

import { useEffect, useState } from "react";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import { useSocket } from "./socket-provider";
import { coalesce } from "./coalesce";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";

const EMPTY: Volcano[] = [];
/** Socket-down fallback cadence — TRACKS_UPDATED:volcanoes is the primary
 *  trigger; NOT the old 120s re-poll. */
const VOLCANO_FALLBACK_MS = 10 * 60 * 1000;

/**
 * The last feed body and what it parsed to. The worker announces
 * TRACKS_UPDATED "volcanoes" from five different sub-jobs (snapshot, wiki
 * enrichment, bulletin parse, USGS patch, catalog update), and each beat used
 * to re-parse the 2.4 MB body and hand every consumer a NEW array of the same
 * volcanoes — so the globe overlay, the ticker lines, the World Watch tally and
 * every broadcast panel keyed on `volcanoes` re-rendered for nothing (a 160 ms
 * React commit + a major GC per beat in the OBS profile, docs/watch-perf-plan.md
 * round 47). An unchanged body now returns the SAME array: React bails out of
 * the setState, memos hold, nothing re-renders. The text compare is a memcmp;
 * the parse only runs when something actually changed.
 */
let last: { text: string; volcanoes: Volcano[] } | null = null;

/** Forget the remembered body (tests). */
export function resetVolcanoFeedCache(): void {
  last = null;
}

/** Plain fetch of the worker-cached volcano feed — every status, no cap.
 *  Shared by the overlay hook below and by anything else that needs a
 *  one-shot read (e.g. the World Watch tally) without the polling machinery.
 *  Returns the previous list on a failed read, so a blip never empties the air. */
export async function listVolcanoes(): Promise<Volcano[]> {
  // Coalesce simultaneous pulls — the globe overlay and the World Watch tally both
  // read this on mount / the same TRACKS_UPDATED beat; share one round-trip.
  return coalesce("/api/volcanoes", async () => {
    const res = await fetch("/api/volcanoes", { cache: "no-store" });
    if (!res.ok) return last?.volcanoes ?? [];
    const text = await res.text();
    if (last && last.text === text) return last.volcanoes;
    let body: { volcanoes?: Volcano[] } | null = null;
    try {
      body = JSON.parse(text);
    } catch {
      return last?.volcanoes ?? [];
    }
    const volcanoes = (body?.volcanoes ?? []) as Volcano[];
    last = { text, volcanoes };
    return volcanoes;
  });
}

/**
 * Poll worker-cached NASA EONET active volcanoes for the globe overlay. Like
 * fires, this is a slow-moving cached feed (no dead reckoning). The worker
 * emits TRACKS_UPDATED (kind:"volcanoes") after each snapshot, so we refetch
 * the instant a snapshot lands; the interval is a fallback. Disabling drops
 * the data.
 */
export function useVolcanoes(enabled: boolean): Volcano[] {
  const [volcanoes, setVolcanoes] = useState<Volcano[]>(EMPTY);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "volcanoes") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setVolcanoes(EMPTY);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const vs = await listVolcanoes();
        // Same array as last time (unchanged body) ⇒ React bails out, no re-render.
        if (!cancelled) setVolcanoes((prev) => (prev === vs ? prev : vs));
      } catch {
        /* leave previous data in place on a transient fetch error */
      }
    };
    poll();
    const iv = setInterval(poll, VOLCANO_FALLBACK_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [enabled, liveTick]);

  return volcanoes;
}
