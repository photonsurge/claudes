/**
 * The director's fresh-event watch: ONE process-wide poll (shared by every
 * scene) that notices new quakes, newly-seen warnings and volcano status flips
 * and keeps them in a short ring. Each scene's break-in decision is then a pure
 * function over that ring (shared/director-break-in.ts), so detecting breaking
 * news never costs a full candidate build per tick.
 *
 * A worker restart must not replay the backlog as break-ins: everything
 * already in the database when the watch starts is marked seen, and only what
 * arrives afterwards enters the ring.
 *
 * `nudge()` (called by the ingest jobs) triggers an immediate poll so a real
 * event reaches air within a tick; the poll stays the source of truth.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import type { FreshEvent } from "@photonsurge/shared/director-break-in";
import { volcanoLevelForStatus } from "@photonsurge/shared/director";
import { alertCountryCode } from "@photonsurge/shared/alerts/country";
import { log } from "@photonsurge/shared/utill/logger";
import { volcanoStatusToSeverity } from "../summaries/aggregate";

const TAG = "director:fresh";

export const FRESH_POLL_MS = Number(process.env.DIRECTOR_FRESH_POLL_MS) || 5000;
/** How long an event stays in the ring — longer than any channel's window can use. */
export const FRESH_RING_MS = 6 * 60 * 60 * 1000;
/** Quakes are re-read over this trailing window of event time (USGS publishes minutes late). */
const QUAKE_LOOKBACK_MS = 60 * 60 * 1000;
/** The loosest bars any channel can set — per-channel bars are applied later. */
const FLOOR_MAG = 2;
const FLOOR_SEVERITY = 0;
/** Cap on remembered keys, so a 24/7 process can't grow it unbounded. */
const SEEN_KEYS_CAP = 20_000;

/** Fresh-event conversions — pure, exported for tests. */
export function quakeEvent(q: { quakeId: string; mag: number; place?: string; lng: number; lat: number; time?: Date | string | null }): FreshEvent {
  const at = q.time ? new Date(q.time).getTime() : NaN;
  return {
    reason: "quake",
    at,
    mag: q.mag,
    segmentId: `quake:${q.quakeId}`,
    key: `quake:${q.quakeId}`,
    score: 40 + q.mag * 10,
    title: `M${q.mag.toFixed(1)}${q.place ? ` · ${q.place}` : ""}`,
    center: [q.lng, q.lat],
  };
}

export function alertEvent(a: any): FreshEvent {
  const info = Array.isArray(a.info) ? a.info[0] : undefined;
  const sev = typeof a.maxSeverityRank === "number" ? a.maxSeverityRank : info?.severityRank ?? 0;
  const country = alertCountryCode(a);
  const id = `storm:${a.source}:${a.identifier}`;
  return {
    reason: "storm",
    at: a.created ? new Date(a.created).getTime() : NaN,
    severityRank: sev,
    segmentId: id,
    key: id,
    score: 50 + sev * 12,
    title: [info?.translatedHeadline || info?.event, info?.area?.[0]?.areaDesc].filter(Boolean).join(" · ") || "Weather warning",
    areaKey: country ? `country:${country}` : undefined,
  };
}

export function volcanoEvent(v: { id: string; name: string; status: "erupting" | "unrest" | "dormant"; lng: number; lat: number; statusChangedAt: number }): FreshEvent {
  return {
    reason: "volcano",
    // A status FLIP is the event; key it with the flip time so a later flip
    // (unrest → erupting) is a new event.
    at: v.statusChangedAt,
    volcanoLevel: volcanoLevelForStatus(v.status),
    segmentId: `volcano:${v.id}`,
    key: `volcano:${v.id}:${v.statusChangedAt}`,
    score: 50 + volcanoStatusToSeverity(v.status) * 12,
    title: `${v.name} · ${v.status}`,
    center: [v.lng, v.lat],
  };
}

export interface FreshEventWatch {
  /** Start polling (idempotent). The first poll only primes what's already there. */
  ensureStarted(db: AppDb): void;
  /** Poll now (tests and nudges). */
  poll(db: AppDb): Promise<void>;
  /** The ring: every fresh event seen since start, newest last. */
  since(): readonly FreshEvent[];
  /** Ask for a poll as soon as possible (ingest jobs call this). */
  nudge(): void;
  stop(): void;
}

export function createFreshEventWatch(opts: { now?: () => number; pollMs?: number } = {}): FreshEventWatch {
  const now = opts.now ?? Date.now;
  const pollMs = opts.pollMs ?? FRESH_POLL_MS;
  let ring: FreshEvent[] = [];
  const seenKeys = new Set<string>();
  let hwm = 0;
  let primed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let db: AppDb | null = null;

  const remember = (key: string) => {
    seenKeys.add(key);
    if (seenKeys.size > SEEN_KEYS_CAP) seenKeys.delete(seenKeys.values().next().value as string);
  };

  async function poll(conn: AppDb): Promise<void> {
    if (polling) return;
    polling = true;
    const t = now();
    try {
      const since = primed ? hwm : t;
      const [quakes, alerts, volcanoes] = await Promise.all([
        conn.quakes.list({ minMag: FLOOR_MAG, sinceMs: t - QUAKE_LOOKBACK_MS, limit: 200 }).catch(() => []),
        primed ? conn.alerts.createdSince(since, { severityMin: FLOOR_SEVERITY }).catch(() => []) : Promise.resolve([]),
        primed ? conn.volcanoes.statusChangedSince(since).catch(() => []) : Promise.resolve([]),
      ]);
      const events = [
        ...quakes.map(quakeEvent),
        ...(alerts as any[]).map(alertEvent),
        ...volcanoes.filter((v) => v.status !== "dormant").map(volcanoEvent),
      ];
      for (const ev of events) {
        if (seenKeys.has(ev.key)) continue;
        remember(ev.key);
        // Priming pass: whatever is already there is backlog, not breaking news.
        if (primed) ring.push(ev);
      }
      if (!primed) log(TAG, "primed", { quakes: quakes.length });
      primed = true;
      hwm = t;
      ring = ring.filter((ev) => !Number.isFinite(ev.at) || t - ev.at <= FRESH_RING_MS);
    } catch (err) {
      log(TAG, "poll failed", String(err));
    } finally {
      polling = false;
    }
  }

  return {
    ensureStarted(conn) {
      db = conn;
      if (timer) return;
      void poll(conn);
      timer = setInterval(() => void poll(conn), pollMs);
    },
    poll,
    since: () => ring,
    nudge() {
      if (db && primed) void poll(db);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/** The worker's one watch. */
export const freshEvents = createFreshEventWatch();
