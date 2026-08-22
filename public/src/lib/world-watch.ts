"use client";

import { useEffect, useMemo, useState } from "react";
import type { Alert } from "./alerts";
import { listAlerts, alertHazard } from "./alerts";
import { listQuakes } from "./tracks/client";
import type { Quake } from "./tracks/types";
import { listVolcanoes } from "./volcanoes-overlay";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import {
  worldWatchSummary,
  worldWatchFeed,
  type WorldSummary,
  type WorldWatchItem,
} from "./broadcast";
import { useSocket } from "./socket-provider";
import { ALERTS_UPDATED, TRACKS_UPDATED } from "@photonsurge/shared/control";
import type { City } from "./cities";

/** The summary tally plus the full scrolling feed of individual alerts + quakes. */
export interface WorldWatchState extends WorldSummary {
  feed: WorldWatchItem[];
}

/**
 * The scrolling ACTIVE FEED (individual event rows) only ever names events
 * worth broadcasting: Severe/Extreme alerts (rank >= 3 — no Moderate or below)
 * and "decent" quakes (M4.5+, the usual widely-felt / significant threshold).
 * The tally (stat tiles, severity/magnitude breakdown, continent bars) is NOT
 * floored — it fetches everything so "how much lesser stuff is out there"
 * actually shows, it's just the named-event crawl that stays curated.
 */
const MIN_ALERT_SEVERITY = 3; // 0 None · 1 Minor · 2 Moderate · 3 Severe · 4 Extreme
const MIN_QUAKE_MAG = 4.5;

const EMPTY_ALERTS: Alert[] = [];
const EMPTY_QUAKES: Quake[] = [];
const EMPTY_VOLCANOES: Volcano[] = [];
/** Fallback re-poll cadence when the socket is down — long, because the socket
 *  beat (worker ingest) is the primary trigger; this is just a safety net so a
 *  dropped/reconnected socket eventually reconciles. Alerts/volcanoes ingest
 *  minutes apart; only quakes move often. */
const ALERT_FALLBACK_MS = 10 * 60 * 1000;
const QUAKE_FALLBACK_MS = 5 * 60 * 1000;
const VOLCANO_FALLBACK_MS = 10 * 60 * 1000;

/**
 * The whole-planet alert + seismic + volcano tally behind the always-on WORLD
 * WATCH panel. Deliberately independent of the operator's showAlerts/showSeismic
 * toggles and the camera bbox — this is a global situation summary that stays on
 * screen no matter what the map is currently showing. We refetch on the same
 * socket beats the overlays use (ALERTS_UPDATED / TRACKS_UPDATED:seismic|volcanoes);
 * the interval is a fallback if the socket is down. The tally fetches every
 * active alert and every cached quake (no severity/magnitude floor) so the full
 * picture — down to Minor alerts and M2.5+ quakes — shows in the stat tiles and
 * continent bars; only the scrolling ACTIVE FEED narrows back down to
 * broadcast-worthy events (see MIN_ALERT_SEVERITY / MIN_QUAKE_MAG). Volcanoes are
 * always fetched in full (every status, no cap) but dormant ones are dropped
 * inside worldWatchSummary/worldWatchFeed — erupting/unrest only, everywhere.
 *
 * `cities` (the curated, wiki-enriched set BroadcastFrame already loads for the
 * "near this event" panel) is optional and only flavours the feed rows with a
 * nearest-city flag — kept out of the network-polling effect's deps so passing
 * a fresh array reference each render doesn't trigger a refetch.
 *
 * Called ONCE by BroadcastFrame and threaded down as a prop to the WORLD REPORT
 * deck (WorldReportDeck) that renders the tally and its ACTIVE FEED from several
 * angles, so a second independent hook instance would double the (potentially
 * 5000-row) fetch on every mount for no reason. `enabled` defers the cold-start
 * fetch until the globe's own textures are ready (see useGlobeReadyOnce), so it
 * doesn't compete with those for bandwidth right when the loading screen is
 * racing to dismiss.
 */
/** Per-channel report content filter — which event kinds / alert hazards feed the
 *  whole report (grid + feed). Empty/absent = everything (the old behaviour). */
export interface WorldWatchFilter {
  kindsOff?: readonly string[];
  hazardsOff?: readonly string[];
}

/**
 * Scope the report's source data to a channel: drop excluded KINDS wholesale
 * (alert/quake/volcano) and, for alerts, drop excluded HAZARDS. Pure and generic
 * (the alert hazard classifier is injected) so it's unit-tested without the
 * fetch/socket hook. Applied BEFORE both the grid summary and the feed so they
 * always agree.
 */
export function scopeReportInputs<A, Q, V>(
  alerts: A[],
  quakes: Q[],
  volcanoes: V[],
  opts: {
    kindsOff?: readonly string[];
    hazardsOff?: readonly string[];
    hazardOf?: (a: A) => string;
  } = {},
): { alerts: A[]; quakes: Q[]; volcanoes: V[] } {
  const kindsOff = new Set(opts.kindsOff ?? []);
  const hazOff = new Set(opts.hazardsOff ?? []);
  let a = kindsOff.has("alert") ? [] : alerts;
  if (hazOff.size && a.length && opts.hazardOf) a = a.filter((x) => !hazOff.has(opts.hazardOf!(x)));
  return {
    alerts: a,
    quakes: kindsOff.has("quake") ? [] : quakes,
    volcanoes: kindsOff.has("volcano") ? [] : volcanoes,
  };
}

export function useWorldWatch(
  cities: City[] = [],
  enabled = true,
  filter?: WorldWatchFilter,
): WorldWatchState {
  const [alerts, setAlerts] = useState<Alert[]>(EMPTY_ALERTS);
  const [quakes, setQuakes] = useState<Quake[]>(EMPTY_QUAKES);
  const [volcanoes, setVolcanoes] = useState<Volcano[]>(EMPTY_VOLCANOES);
  const { socket } = useSocket();

  // Three INDEPENDENT socket-driven fetchers — the whole point of the split: an
  // alerts refetch is the 7s one (5000 CAP docs), so it must fire ONLY when
  // alerts actually change (ALERTS_UPDATED, minutes apart), never on the frequent
  // quake/volcano ticks. Previously one combined poll re-pulled all three on any
  // beat + every 60s, so every quake update paid the 7s alerts cost. Each fetcher
  // does one initial load, then refetches on its own socket event, with a long
  // interval only as a socket-down fallback. (The Redis feed-cache makes the
  // occasional refetch a hit anyway.)
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () =>
      listAlerts({ activeOnly: true, limit: 5000, lean: true, omitCoordinates: true }).then((a) => {
        if (!cancelled) setAlerts(a);
      });
    load();
    const onAlerts = () => load();
    socket?.on(ALERTS_UPDATED, onAlerts);
    const iv = setInterval(load, ALERT_FALLBACK_MS);
    return () => {
      cancelled = true;
      socket?.off(ALERTS_UPDATED, onAlerts);
      clearInterval(iv);
    };
  }, [enabled, socket]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () =>
      listQuakes().then((r) => {
        if (!cancelled) setQuakes(r.quakes);
      });
    load();
    const onTracks = (p?: { kind?: string }) => {
      if (!p || p.kind === "seismic") load();
    };
    socket?.on(TRACKS_UPDATED, onTracks);
    const iv = setInterval(load, QUAKE_FALLBACK_MS);
    return () => {
      cancelled = true;
      socket?.off(TRACKS_UPDATED, onTracks);
      clearInterval(iv);
    };
  }, [enabled, socket]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () =>
      listVolcanoes().then((v) => {
        if (!cancelled) setVolcanoes(v);
      });
    load();
    const onTracks = (p?: { kind?: string }) => {
      if (!p || p.kind === "volcanoes") load();
    };
    socket?.on(TRACKS_UPDATED, onTracks);
    const iv = setInterval(load, VOLCANO_FALLBACK_MS);
    return () => {
      cancelled = true;
      socket?.off(TRACKS_UPDATED, onTracks);
      clearInterval(iv);
    };
  }, [enabled, socket]);

  // Stable primitive keys so the memo only recomputes when the filter actually
  // changes (arrays are fresh each render).
  const kindsKey = (filter?.kindsOff ?? []).join(",");
  const hazKey = (filter?.hazardsOff ?? []).join(",");

  return useMemo(() => {
    const scoped = scopeReportInputs(alerts, quakes, volcanoes, {
      kindsOff: kindsKey ? kindsKey.split(",") : [],
      hazardsOff: hazKey ? hazKey.split(",") : [],
      hazardOf: alertHazard,
    });
    const feedAlerts = scoped.alerts.filter((a) => a.maxSeverityRank >= MIN_ALERT_SEVERITY);
    const feedQuakes = scoped.quakes.filter((q) => q.mag >= MIN_QUAKE_MAG);
    return {
      ...worldWatchSummary(scoped.alerts, scoped.quakes, scoped.volcanoes),
      feed: worldWatchFeed(feedAlerts, feedQuakes, cities, scoped.volcanoes),
    };
  }, [alerts, quakes, volcanoes, cities, kindsKey, hazKey]);
}
