/**
 * The lineup template (docs/short-video-plan.md §4): for a scope (a country, an
 * area or the globe) and the include switches, write the clip list of a short
 * video —
 *
 *   opener (the place's tour / the world round-up)
 *   → the scope's active events, best first, varied by hazard
 *   → a short closing wide shot.
 *
 * Two modes, picked by the switches:
 *  • ROUND-UP ONLY (no switch on, the default): opener + close. The opener runs
 *    its natural length — the read time of the round-up it shows (its summary,
 *    or all of it: the format's round-up depth) at the scene's read pace —
 *    even past the budget, so prose is never cut short. No usable round-up is
 *    an error, not a video.
 *  • WITH EVENTS: the opener starts at its share of the budget (the format's
 *    `opener.budgetShare`, 40% by default), events fill the rest best-first,
 *    and any budget they leave is handed back to the opener (up to its natural
 *    length). Total never exceeds the budget.
 *
 * The format (shared/src/short-format.ts) shapes the rest: whether the deck
 * leads with the round-up, whether the opener flies its tour, the minimum tour
 * dwell, and whether there is a close and how long it is.
 *
 * Clips are REFERENCES (segment ids), so every candidate here comes from the
 * same single-item builders the live pool uses: the segment id is the clip's
 * target, its title/subtitle/icon the editor label, its `holdMs` the clip's
 * default length and its `score` the ranking. The budget is the only limit on
 * how many events go in.
 *
 * A country/area opener's tour is paced to its clip: as many stops as fit at
 * the format's minimum dwell each, spread evenly over the whole opener (`tourDwellMs`),
 * not the live channel's 40 s a stop — which would make a minute-long round-up
 * a one-city visit.
 */
import { randomUUID } from "node:crypto";
import type { AppDb } from "@photonsurge/shared/db/index";
import { kindHoldMs, type DirectorConfig, type Segment } from "@photonsurge/shared/director";
import { coarseGeoCell, type Candidate } from "@photonsurge/shared/director-select";
import {
  DEFAULT_SHORT_BUDGET_MS,
  MAX_CLIP_MS,
  MIN_CLIP_MS,
  TARGET_WORLD_ROUNDUP,
  TARGET_WORLD_SPIN,
  TOUR_DWELL_MAX_MS,
  shortPlaceName,
  type RoundupDepth,
  type ShortClip,
  type ShortInclude,
  type ShortPlace,
  type ShortScope,
} from "@photonsurge/shared/short-script";
import {
  DEFAULT_CLOSE_MS,
  DEFAULT_MIN_TOUR_DWELL_MS,
  DEFAULT_OPENER_BUDGET_SHARE,
  defaultShortFormat,
  type ShortFormat,
} from "@photonsurge/shared/short-format";
import { clampReadCps, readSeconds, DEFAULT_READ_CPS } from "@photonsurge/shared/reading-pace";
import type { iPlaceRoundupModel } from "@photonsurge/shared/db/place-roundup-model";
import {
  countryCandidate,
  regionCandidate,
  stormCandidate,
  quakeCandidate,
  volcanoCandidate,
  summaryCandidate,
  worldSpinCandidate,
  SUMMARY_PERIODS,
  SUMMARY_STOP_DWELL_MS,
} from "./builders";
import { ROUNDUP_ID_FOR_PERIOD } from "@photonsurge/shared/roundup-settings";
import { roundupStaleAfterMs } from "@photonsurge/shared/roundup-schedule";
import { cachedRoundupSettings } from "../lib/roundupSettings";
import { applyClip, refreshClipLabel } from "./script-resolve";
import { ALERT_COUNTRY_CAP } from "./candidates";
import { resolveScope, scopeAlerts, scopeQuakes, scopeVolcanoes, type ResolvedScope } from "./script-scope";

/** Defaults for a format that doesn't say (the format's `opener.budgetShare`,
 *  `close.ms` and `opener.minTourDwellMs` win). */
export const OPENER_BUDGET_SHARE = DEFAULT_OPENER_BUDGET_SHARE;
/** The closing wide shot — a beat to end on, reserved before events are picked. */
export const CLOSE_MS = DEFAULT_CLOSE_MS;
/** The shortest camera dwell on a tour stop in a scripted clip: enough for the
 *  camera to land and the stop's caption to read. Sets how many stops fit. */
export const MIN_TOUR_DWELL_MS = DEFAULT_MIN_TOUR_DWELL_MS;

/** The parts of a format that shape a lineup. */
export type LineupShape = Pick<ShortFormat, "opener" | "close">;

/** Every switch off: a round-up-only video. */
export const ROUNDUP_ONLY: ShortInclude = { alerts: false, quakes: false, volcanoes: false };

export interface LineupOptions {
  scope: ShortScope;
  /** Which event kinds to add; defaults to none (round-up only). */
  include?: ShortInclude;
  /** Target length; defaults to DEFAULT_SHORT_BUDGET_MS. Round-up-only openers may exceed it. */
  budgetMs?: number;
  /** On-air read pace (chars/s) that sizes a round-up's read time — the target
   *  scene's `ControlState.readPaceCps`. Clamped; defaults to DEFAULT_READ_CPS. */
  readCps?: number;
  /** The format's opener and close; defaults to a new format's. */
  shape?: LineupShape;
  /** Several places: open on the world round-up before the first place
   *  (the format's `template.openWithWorld`). Ignored for other scopes. */
  openWithWorld?: boolean;
  now?: number;
}

/** A place (or the world round-up) a several-places video left out, and why. */
export interface SkippedPlace {
  /** "country:usa" · "area:europe" · "world" (the world round-up opener). */
  place: string;
  /** Its display name ("United States"). */
  name: string;
  reason: string;
}

/** What `buildLineup` writes. `skipped` is only set for a several-places video. */
export interface Lineup {
  title: string;
  clips: ShortClip[];
  skipped?: SkippedPlace[];
}

type EventKind = keyof ShortInclude;
/** Fixed kind order: the "best of each kind" pass and score ties follow it. */
const EVENT_KINDS: EventKind[] = ["alerts", "quakes", "volcanoes"];

export const isRoundupOnly = (include: ShortInclude): boolean => !EVENT_KINDS.some((k) => include[k]);

/** One scored event the picker can place. */
export interface EventPick {
  kind: EventKind;
  /** "One per hazard type" key: a storm's hazard; quakes and volcanoes are each one type. */
  type: string;
  /** Per-country cap key (alerts on area/globe scopes only). */
  capKey?: string;
  cand: Candidate;
}

const clipOf = (seg: Segment, durationMs: number, extra: Partial<ShortClip> = {}): ShortClip => ({
  id: randomUUID(),
  target: seg.id,
  durationMs: Math.round(durationMs),
  label: refreshClipLabel(seg),
  ...extra,
});

/**
 * The round-up prose that reaches air at `depth`, as /watch's PlaceRoundupPanel
 * renders it. `full` (the default): summary, state of play, each city's
 * "Name — outlook" and advice, across its "main" and "next24" sections.
 * `summary`: the summary alone. Either way, an older round-up with none of
 * those sections reads its composed narrative. "" when there's nothing to read.
 */
export function roundupText(r: iPlaceRoundupModel | null | undefined, depth: RoundupDepth = "full"): string {
  if (!r) return "";
  const cities = (r.cityOutlook ?? []).filter((c) => c.name && c.outlook).map((c) => `${c.name} — ${c.outlook}`);
  const sections = [r.summary?.trim(), r.stateOfPlay?.trim(), ...cities, r.advice?.trim()].filter(Boolean);
  if (!sections.length) return r.narrative?.trim() ?? "";
  return depth === "summary" ? r.summary?.trim() ?? "" : sections.join(" ");
}

/** How long a viewer needs to read a round-up at `depth` and `cps` (default the on-air default pace), ms. */
export const roundupReadMs = (
  r: iPlaceRoundupModel | null | undefined,
  cps: number = DEFAULT_READ_CPS,
  depth: RoundupDepth = "full",
): number => Math.round(readSeconds(roundupText(r, depth).length, cps) * 1000);

/**
 * How many of a tour's `stops` a `openerMs` clip flies, and the dwell that
 * spreads them evenly across it: each stop costs a flight (`transitionMs`) and
 * at least `minDwellMs` (the format's minimum tour dwell) on the ground. None
 * fit → `maxStops: 0`, one framed view and no dwell. The dwell is capped at
 * TOUR_DWELL_MAX_MS (a short tour on a long read then parks on its last stop).
 */
export function tourFit(
  stops: number,
  openerMs: number,
  transitionMs: number,
  minDwellMs: number = MIN_TOUR_DWELL_MS,
): Pick<ShortClip, "maxStops" | "tourDwellMs"> {
  const kept = Math.max(0, Math.min(stops, Math.floor(openerMs / (transitionMs + minDwellMs))));
  if (!kept) return { maxStops: 0 };
  return { maxStops: kept, tourDwellMs: Math.min(TOUR_DWELL_MAX_MS, Math.floor(openerMs / kept) - transitionMs) };
}

/**
 * How an opener may be sized: never below the kind's hold (`floorMs`), at most
 * its `naturalMs`. A country/area opener has a tour of `stops` stops, paced
 * into whatever length it gets (`tourFit`, at `minDwellMs` a stop); `segment`
 * is what it was built from, so its label can say what will really air.
 */
interface OpenerPlan {
  clip: ShortClip;
  segment: Segment | null;
  floorMs: number;
  naturalMs: number;
  stops: number;
  transitionMs: number;
  minDwellMs: number;
}

/** Size the opener inside `softCapMs` (it may still reach its floor) and never past `hardCapMs`. */
function sizeOpener(p: OpenerPlan, softCapMs: number, hardCapMs: number): ShortClip {
  const d = Math.min(p.naturalMs, Math.max(p.floorMs, softCapMs), hardCapMs);
  const clip: ShortClip = { ...p.clip, durationMs: Math.round(Math.max(MIN_CLIP_MS, d)) };
  if (p.stops) Object.assign(clip, tourFit(p.stops, clip.durationMs, p.transitionMs, p.minDwellMs));
  if (p.segment) clip.label = refreshClipLabel(applyClip(p.segment, clip));
  return clip;
}

/** The freshest world round-up that has a narrative and isn't stale, or null. */
async function freshWorldRoundup(db: AppDb, cfg: DirectorConfig, now: number): Promise<Candidate | null> {
  let best: { at: number; cand: Candidate } | null = null;
  const settings = await cachedRoundupSettings(db); // stale-after follows the operator's slots
  for (const { period, staleAfterMs } of SUMMARY_PERIODS) {
    const doc = await db.eventSummaries.latest(period).catch(() => null);
    if (!doc) continue;
    const at = new Date(doc.generatedAt).getTime();
    if (!(now - at <= roundupStaleAfterMs(settings[ROUNDUP_ID_FOR_PERIOD[period]], staleAfterMs))) continue;
    const cand = summaryCandidate(doc, period, cfg);
    if (cand && (!best || at > best.at)) best = { at, cand };
  }
  return best?.cand ?? null;
}

/**
 * The opener plan and the closing shot for a scope, shaped by the format.
 * `close` is null when the format has none. Throws when a round-up-only video
 * has no round-up.
 */
async function bookends(
  db: AppDb,
  cfg: DirectorConfig,
  rs: ResolvedScope,
  roundupOnly: boolean,
  readCps: number,
  shape: LineupShape,
  now: number,
): Promise<{ plan: OpenerPlan; close: ShortClip | null }> {
  const transitionMs = Math.round((cfg.transitionSeconds ?? 4) * 1000);
  const { opener } = shape;
  const minDwellMs = opener.minTourDwellMs;
  const closeMs = shape.close.ms;
  if (rs.type === "globe") {
    const roundup = await freshWorldRoundup(db, cfg, now);
    if (!roundup && roundupOnly) {
      throw new Error(
        "No fresh world round-up to make a round-up video from: none of the hourly/12-hour/daily round-ups " +
          "has a narrative inside its stale-after window. Run the round-up job, or turn on an include switch.",
      );
    }
    const spinMs = kindHoldMs(cfg, "global");
    const spin = worldSpinCandidate(cfg).segment;
    // The round-up target either way — it resolves to a plain world spin at
    // play time when nothing is fresh. Its natural length is the round-up's
    // own hold (summaryTourHoldMs: the tour, or the narration).
    const clip: ShortClip = {
      id: randomUUID(),
      target: TARGET_WORLD_ROUNDUP,
      durationMs: 0,
      label: refreshClipLabel(roundup ? roundup.segment : spin),
    };
    const naturalMs = roundup ? Math.max(spinMs, roundup.segment.holdMs) : spinMs;
    const close: ShortClip | null = shape.close.enabled
      ? { id: randomUUID(), target: TARGET_WORLD_SPIN, durationMs: closeMs, label: refreshClipLabel(spin) }
      : null;
    return { plan: { clip, segment: null, floorMs: spinMs, naturalMs, stops: 0, transitionMs, minDwellMs }, close };
  }

  const isCountry = rs.type === "country";
  const cand = isCountry ? await countryCandidate(db, rs.shot, cfg) : await regionCandidate(db, rs.shot, cfg);
  const seg = cand.segment;
  const roundups = isCountry ? db.countryRoundups : db.regionRoundups;
  const placeId = isCountry ? rs.shot.iso2.toLowerCase() : rs.shot.id;
  const roundup = await roundups.latestForPlace(placeId).catch(() => null);
  const depth = opener.roundupDepth;
  const readMs = roundupReadMs(roundup, readCps, depth);
  if (!readMs && roundupOnly) {
    throw new Error(
      `No usable round-up for ${rs.shot.name} (${rs.type} "${isCountry ? rs.shot.id : placeId}"): ` +
        `switch round-ups on for it at /admin/place-roundups and let one generate, or turn on an include switch.`,
    );
  }

  const floorMs = kindHoldMs(cfg, seg.kind);
  // No tour: the opener holds one framed shot (maxStops 0 drops the tour).
  const stops = opener.tour ? seg.tourStops?.length ?? 0 : 0;
  const hasRoundup = readMs > 0;
  const extra: Partial<ShortClip> = opener.tour ? {} : { maxStops: 0 };
  if (hasRoundup) {
    extra.roundupDepth = depth;
    if (opener.leadWithRoundup) extra.leadSlide = "roundup";
  }
  const clip = clipOf(seg, 0, extra);
  // With a round-up, the prose shown sets the length (leading or not, it must
  // be readable) and the tour is paced into it; otherwise the natural length is
  // the whole tour at the live pace, or the kind's hold for a framed shot.
  const naturalMs = hasRoundup ? Math.max(floorMs, readMs) : Math.max(floorMs, stops * (transitionMs + SUMMARY_STOP_DWELL_MS));
  let close: ShortClip | null = null;
  if (shape.close.enabled) {
    close = clipOf(seg, closeMs, { maxStops: 0 });
    close.label = refreshClipLabel(applyClip(seg, close));
  }
  return { plan: { clip, segment: seg, floorMs, naturalMs, stops, transitionMs, minDwellMs }, close };
}

/** Every in-scope event of the included kinds, scored by the director's own builders. */
export async function scopeEvents(
  db: AppDb,
  cfg: DirectorConfig,
  rs: ResolvedScope,
  include: ShortInclude,
  now: number,
): Promise<EventPick[]> {
  const out: EventPick[] = [];
  const capped = rs.type !== "country";
  if (include.alerts) {
    for (const a of await scopeAlerts(db, cfg, rs)) {
      const info = Array.isArray(a.info) ? a.info[0] : undefined;
      const cand = stormCandidate(a, info, info?.area?.[0], cfg, now);
      if (!cand) continue;
      // Same bucket as the live pool's cap: the decoded country, else a coarse cell.
      const capKey = capped ? cand.areaKey ?? coarseGeoCell(cand.segment.camera.center) ?? "cell:unknown" : undefined;
      out.push({ kind: "alerts", type: `storm:${cand.segment.hazard ?? "other"}`, capKey, cand });
    }
  }
  if (include.quakes) {
    for (const q of await scopeQuakes(db, cfg, rs, now)) {
      out.push({ kind: "quakes", type: "quake", cand: quakeCandidate(q, cfg, now) });
    }
  }
  if (include.volcanoes) {
    for (const v of await scopeVolcanoes(db, rs)) {
      const cand = volcanoCandidate(v, cfg, now);
      if (cand) out.push({ kind: "volcanoes", type: "volcano", cand });
    }
  }
  return out;
}

/**
 * Pick events into `budgetMs`, in order:
 *  1. the best event of each included kind that fits, so a kind with anything
 *     active always appears;
 *  2. the rest by score, one per hazard type per round before a second of a type.
 * Alerts carrying a `capKey` take at most ALERT_COUNTRY_CAP per key. An event
 * that doesn't fit what's left is passed over; smaller ones behind it are tried.
 */
export function pickEvents(events: EventPick[], budgetMs: number): EventPick[] {
  const ranked = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.cand.score - a.e.cand.score || EVENT_KINDS.indexOf(a.e.kind) - EVENT_KINDS.indexOf(b.e.kind) || a.i - b.i)
    .map((x) => x.e);
  const picked: EventPick[] = [];
  const taken = new Set<EventPick>();
  const perType = new Map<string, number>();
  const perCap = new Map<string, number>();
  let left = budgetMs;

  const fits = (e: EventPick) =>
    e.cand.segment.holdMs <= left && (!e.capKey || (perCap.get(e.capKey) ?? 0) < ALERT_COUNTRY_CAP);
  const take = (e: EventPick) => {
    picked.push(e);
    taken.add(e);
    left -= e.cand.segment.holdMs;
    perType.set(e.type, (perType.get(e.type) ?? 0) + 1);
    if (e.capKey) perCap.set(e.capKey, (perCap.get(e.capKey) ?? 0) + 1);
  };

  for (const kind of EVENT_KINDS) {
    const best = ranked.find((e) => e.kind === kind && fits(e));
    if (best) take(best);
  }
  // Round r admits an event only while its type has fewer than r picks. Later
  // rounds only loosen the type rule, so stop once nothing left fits.
  for (let round = 1; ranked.some((e) => !taken.has(e) && fits(e)); round++) {
    for (const e of ranked) {
      if (taken.has(e) || (perType.get(e.type) ?? 0) >= round || !fits(e)) continue;
      take(e);
    }
  }
  return picked;
}

const KIND_WORDS: Record<EventKind, string> = { alerts: "alerts", quakes: "earthquakes", volcanoes: "volcanoes" };

/** "a", "a and b", "a, b and c". */
const listWords = (words: string[]): string =>
  words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

/** A plain human title operators will edit: "Japan round-up", "Japan — alerts and earthquakes". */
export function lineupTitle(rs: ResolvedScope, include: ShortInclude): string {
  const name = rs.type === "globe" ? "World" : rs.shot.name;
  const kinds = EVENT_KINDS.filter((k) => include[k]);
  return kinds.length ? `${name} — ${listWords(kinds.map((k) => KIND_WORDS[k]))}` : `${name} round-up`;
}

/** "Europe, United States and Asia round-up"; past three places, "Europe,
 *  United States, Asia and 3 more round-up". */
export function placesTitle(names: string[]): string {
  const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  return `${listWords(shown)} round-up`;
}

/** Why a place's opener couldn't be built, in a few words for the result. */
const skipReason = (err: unknown): string => {
  const msg = String((err as Error)?.message ?? err);
  if (/No usable round-up/.test(msg)) return "no usable round-up";
  return msg;
};

/**
 * Several places in one video (§4, `places` scope). Round-up only: the include
 * switches are ignored. One clip per place, in the order given — each that
 * place's opener (its tour, the round-up leading as the format says), as long
 * as the round-up takes to read at the format's depth. The world round-up opens
 * it when `openWithWorld` is set and one is fresh. It closes on a world spin
 * (the format's close length; none when the format's close is off).
 *
 * A place with no usable round-up (or an id the catalog no longer knows) is
 * left out and named in `skipped`; so is a world opener with nothing fresh.
 * With no place left it is an error.
 */
async function buildPlacesLineup(
  db: AppDb,
  cfg: DirectorConfig,
  places: ShortPlace[],
  opts: { budgetMs: number; readCps: number; shape: LineupShape; openWithWorld: boolean; now: number },
): Promise<Lineup> {
  const { shape, readCps, now } = opts;
  const skipped: SkippedPlace[] = [];
  const clips: ShortClip[] = [];
  const kept: string[] = [];
  for (const place of places) {
    const name = shortPlaceName(place);
    try {
      const rs = await resolveScope(db, place);
      const { plan } = await bookends(db, cfg, rs, true, readCps, shape, now);
      clips.push(sizeOpener(plan, plan.naturalMs, MAX_CLIP_MS));
      kept.push(name);
    } catch (err) {
      skipped.push({ place: `${place.type}:${place.id}`, name, reason: skipReason(err) });
    }
  }
  if (!clips.length) {
    const why = skipped.map((s) => `${s.name}: ${s.reason}`).join("; ");
    throw new Error(
      `No usable round-up for any of the ${places.length} places (${why}). ` +
        `Switch round-ups on at /admin/place-roundups and let them generate.`,
    );
  }

  if (opts.openWithWorld) {
    const world = await freshWorldRoundup(db, cfg, now);
    if (world) {
      const spinMs = kindHoldMs(cfg, "global");
      const durationMs = Math.min(MAX_CLIP_MS, Math.max(spinMs, world.segment.holdMs));
      clips.unshift({ id: randomUUID(), target: TARGET_WORLD_ROUNDUP, durationMs, label: refreshClipLabel(world.segment) });
    } else {
      skipped.push({ place: "world", name: "World", reason: "no fresh world round-up" });
    }
  }

  if (shape.close.enabled) {
    const spin = worldSpinCandidate(cfg).segment;
    const closeMs = Math.max(MIN_CLIP_MS, Math.min(shape.close.ms, Math.floor(opts.budgetMs / 2)));
    clips.push({ id: randomUUID(), target: TARGET_WORLD_SPIN, durationMs: closeMs, label: refreshClipLabel(spin) });
  }
  return { title: placesTitle(kept), clips, skipped };
}

/**
 * Write a lineup for `scope`: opener, events, close (when the format has one).
 * With events the total is at most the budget; round-up only, the opener takes
 * its natural length (up to MAX_CLIP_MS). A quiet scope is just the opener and
 * the close. Throws for an unknown country/area id, and for a round-up-only
 * video with no round-up. A `places` scope is its own lineup
 * (`buildPlacesLineup`): round-up only, whatever the switches say.
 */
export async function buildLineup(db: AppDb, cfg: DirectorConfig, opts: LineupOptions): Promise<Lineup> {
  const now = opts.now ?? Date.now();
  // Two clips need room to exist at all.
  const budgetMs = Math.max(2 * MIN_CLIP_MS, Math.round(opts.budgetMs ?? DEFAULT_SHORT_BUDGET_MS));
  const readCps = clampReadCps(opts.readCps ?? DEFAULT_READ_CPS);
  const shape = opts.shape ?? defaultShortFormat();
  if (opts.scope.type === "places") {
    return buildPlacesLineup(db, cfg, opts.scope.places, {
      budgetMs,
      readCps,
      shape,
      openWithWorld: opts.openWithWorld === true,
      now,
    });
  }
  const include = opts.include ?? ROUNDUP_ONLY;
  const roundupOnly = isRoundupOnly(include);
  const rs = await resolveScope(db, opts.scope);
  const { plan, close } = await bookends(db, cfg, rs, roundupOnly, readCps, shape, now);
  const title = lineupTitle(rs, include);
  if (close) close.durationMs = Math.max(MIN_CLIP_MS, Math.min(close.durationMs, Math.floor(budgetMs / 2)));
  const tail = close ? [close] : [];

  if (roundupOnly) {
    // The budget is for fitting events, never for cutting the round-up short.
    return { title, clips: [sizeOpener(plan, plan.naturalMs, MAX_CLIP_MS), ...tail] };
  }

  // The opener holds its share while events are picked; whatever budget they
  // leave goes back to it, up to its natural length.
  const roomMs = budgetMs - (close?.durationMs ?? 0);
  const first = sizeOpener(plan, budgetMs * shape.opener.budgetShare, roomMs);
  const picked = pickEvents(await scopeEvents(db, cfg, rs, include, now), roomMs - first.durationMs);
  const eventsMs = picked.reduce((sum, e) => sum + e.cand.segment.holdMs, 0);
  const left = roomMs - eventsMs;
  const opener = sizeOpener(plan, left, left);
  const middle = picked.map((e) => clipOf(e.cand.segment, e.cand.segment.holdMs));
  return { title, clips: [opener, ...middle, ...tail] };
}
