/**
 * Director break-ins — which fresh events count as "breaking" on a channel and
 * may jump (or, later, interrupt) the running programme.
 *
 * One notion of "breaking" per channel: `DirectorConfig.breakIn` decides which
 * events qualify (reasons, thresholds, freshness window). The candidate builders
 * stamp `Candidate.breakIn` through `qualifiesAsBreakIn`, and `selectPriority`
 * reads that stamp for the boundary tier. The queue/interrupt half
 * (`reconcilePending`, `selectBreakIn`) lands with the immediate mode.
 *
 * Defaults reproduce the show as it was before this existed: boundary mode,
 * the 20 min / 6 h windows, quakes + storms + eruptions, round-ups off, and
 * thresholds that follow the channel's pool bar exactly.
 *
 * See docs/director-programme-plan.md §3.2 and §3.5.
 */
import type { SeverityRank } from "./db/alert-model";
import type { VolcanoLevel } from "./director";

export type BreakInReason = "quake" | "storm" | "volcano" | "roundup";

/** Priority order: the first reason with anything waiting wins. */
export const BREAK_IN_REASONS: readonly BreakInReason[] = ["quake", "storm", "volcano", "roundup"];

export interface BreakInConfig {
  /** Off = no breaking tier at all on this channel (pure fair rotation). */
  enabled: boolean;
  /** "boundary" jumps the queue at the next shot change (today's behaviour);
   *  "immediate" cuts into the running shot. */
  interrupt: "boundary" | "immediate";
  /** Which reasons may break in. Round-ups default off. */
  reasons: Record<BreakInReason, boolean>;
  /**
   * The BREAK-IN bar, separate from and never below the channel's POOL bar
   * (`DirectorConfig.minQuakeMag` / `minAlertSeverity`, "what may air at all").
   * `mergeBreakIn` clamps each up to its pool counterpart, so the default of 0
   * means "whatever the pool airs" and a config can never promise a break-in
   * for something the pool filters out.
   */
  minQuakeMag: number;
  minAlertSeverity: SeverityRank;
  /** "erupting" = eruptions only; "unrest" also breaks in on a flip to unrest. */
  volcanoMin: VolcanoLevel;
  /** How fresh a quake / alert must be, minutes. Volcanoes keep their own window. */
  windowMinutes: number;
  /** Immediate mode: never interrupt a shot younger than this, seconds. */
  guardSeconds: number;
  /** Immediate mode: min gap between two event break-ins, seconds. */
  cooldownSeconds: number;
  /** A burst of at least this many of one reason airs as one grouped cut. 0 = never group. */
  clusterMin: number;
  /** The burst must land within this many seconds to group. */
  clusterWindowSeconds: number;
  /** Max break-ins queued at once; the lowest-scored fall off (logged). */
  maxPending: number;
  /** Min gap between two round-up break-ins, minutes. */
  roundupCooldownMinutes: number;
  /** Which cuts get the on-air INCOMING pre-roll. */
  incoming: "off" | "breakIns" | "allEvents";
  /** Pre-roll length, seconds. 0 = match the channel's transitionSeconds. */
  incomingSeconds: number;
  /** Count the hourly world round-up under the "roundup" reason too. */
  worldRoundup: boolean;
}

export const DEFAULT_BREAK_IN: BreakInConfig = {
  enabled: true,
  interrupt: "boundary",
  reasons: { quake: true, storm: true, volcano: true, roundup: false },
  minQuakeMag: 0,
  minAlertSeverity: 0,
  volcanoMin: "erupting",
  windowMinutes: 20,
  guardSeconds: 6,
  cooldownSeconds: 120,
  clusterMin: 3,
  clusterWindowSeconds: 180,
  maxPending: 12,
  roundupCooldownMinutes: 30,
  incoming: "breakIns",
  incomingSeconds: 0,
  worldRoundup: false,
};

/**
 * Volcano status comes from a weekly bulletin, so there is no "it just
 * happened" timestamp — `statusChangedAt` is when our cache saw the status
 * flip. A few hours lets that flip surface across a couple of poll cycles
 * without staying breaking for a multi-week eruption.
 */
export const VOLCANO_BREAK_IN_WINDOW_MS = 6 * 60 * 60 * 1000;

/** The channel's pool bar — what may air at all. The break-in bar never sits below it. */
export interface PoolBar {
  minQuakeMag: number;
  minAlertSeverity: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Merge an untrusted partial break-in config onto a base. Unknown keys are
 * dropped, `reasons` merges key by key, numbers are clamped, and the two
 * thresholds are raised to the pool bar.
 */
export function mergeBreakIn(base: BreakInConfig, patch: unknown, pool: PoolBar): BreakInConfig {
  const p = (patch && typeof patch === "object" ? patch : {}) as Partial<Record<keyof BreakInConfig, unknown>>;
  const num = (v: unknown, d: number, min: number, max: number, integer = false) => {
    const n = finite(v) ? clamp(v, min, max) : d;
    return integer ? Math.round(n) : n;
  };
  const reasons = { ...base.reasons };
  if (p.reasons && typeof p.reasons === "object") {
    for (const r of BREAK_IN_REASONS) {
      const v = (p.reasons as Record<string, unknown>)[r];
      if (typeof v === "boolean") reasons[r] = v;
    }
  }
  const minQuakeMag = num(p.minQuakeMag, base.minQuakeMag, 0, 10);
  const minAlertSeverity = num(p.minAlertSeverity, base.minAlertSeverity, 0, 4, true);
  return {
    enabled: typeof p.enabled === "boolean" ? p.enabled : base.enabled,
    interrupt: p.interrupt === "boundary" || p.interrupt === "immediate" ? p.interrupt : base.interrupt,
    reasons,
    minQuakeMag: Math.max(minQuakeMag, finite(pool.minQuakeMag) ? pool.minQuakeMag : 0),
    minAlertSeverity: Math.max(
      minAlertSeverity,
      finite(pool.minAlertSeverity) ? Math.round(pool.minAlertSeverity) : 0,
    ) as SeverityRank,
    volcanoMin: p.volcanoMin === "erupting" || p.volcanoMin === "unrest" ? p.volcanoMin : base.volcanoMin,
    windowMinutes: num(p.windowMinutes, base.windowMinutes, 1, 24 * 60),
    guardSeconds: num(p.guardSeconds, base.guardSeconds, 0, 600),
    cooldownSeconds: num(p.cooldownSeconds, base.cooldownSeconds, 10, 3600),
    clusterMin: num(p.clusterMin, base.clusterMin, 0, 10, true),
    clusterWindowSeconds: num(p.clusterWindowSeconds, base.clusterWindowSeconds, 10, 3600),
    maxPending: num(p.maxPending, base.maxPending, 1, 100, true),
    roundupCooldownMinutes: num(p.roundupCooldownMinutes, base.roundupCooldownMinutes, 5, 24 * 60),
    incoming:
      p.incoming === "off" || p.incoming === "breakIns" || p.incoming === "allEvents" ? p.incoming : base.incoming,
    incomingSeconds: num(p.incomingSeconds, base.incomingSeconds, 0, 15),
    worldRoundup: typeof p.worldRoundup === "boolean" ? p.worldRoundup : base.worldRoundup,
  };
}

/**
 * A fresh event as the break-in check sees it. The candidate builders fill in
 * the fields for their own reason; the fresh-event watch (immediate mode) adds
 * the rest.
 */
export interface FreshEvent {
  reason: BreakInReason;
  /** When it happened: quake time, alert first-seen, volcano status flip, round-up generatedAt. Ms epoch; NaN = unknown. */
  at: number;
  mag?: number;
  severityRank?: number;
  /** Current volcano status level. */
  volcanoLevel?: VolcanoLevel;
  /** Round-ups: which place the round-up is for. */
  placeKind?: "country" | "region" | "world";
  placeId?: string;
}

export interface BreakInFavourites {
  countries: ReadonlySet<string>;
  regions: ReadonlySet<string>;
}

/**
 * Does this event count as breaking on this channel? The reason must be enabled,
 * its threshold met, and it must be inside the freshness window. A round-up
 * qualifies only for a favourite place (or the world round-up when opted in).
 * The master switch is NOT checked here: a disabled channel simply never runs
 * the priority tier (see `selectPriority`).
 */
export function qualifiesAsBreakIn(
  ev: FreshEvent,
  cfg: BreakInConfig,
  favourites: BreakInFavourites,
  now: number,
): boolean {
  if (!cfg.reasons[ev.reason]) return false;
  if (!Number.isFinite(ev.at)) return false;
  const age = now - ev.at;
  switch (ev.reason) {
    case "quake":
      return age <= cfg.windowMinutes * 60_000 && (ev.mag ?? -Infinity) >= cfg.minQuakeMag;
    case "storm":
      return age <= cfg.windowMinutes * 60_000 && (ev.severityRank ?? -1) >= cfg.minAlertSeverity;
    case "volcano": {
      if (age > VOLCANO_BREAK_IN_WINDOW_MS) return false;
      if (ev.volcanoLevel === "erupting") return true;
      return cfg.volcanoMin === "unrest" && ev.volcanoLevel === "unrest";
    }
    case "roundup":
      if (ev.placeKind === "world") return cfg.worldRoundup;
      if (ev.placeKind === "country") return !!ev.placeId && favourites.countries.has(ev.placeId);
      if (ev.placeKind === "region") return !!ev.placeId && favourites.regions.has(ev.placeId);
      return false;
  }
}
