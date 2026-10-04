/**
 * Director commands, worker side: turn a command's target into the exact
 * segment the director would have built itself (through the same single-item
 * builders rotation uses), and apply the control ops (skip / hold / pause /
 * resume / clear) to a scene's runner.
 *
 * See shared/director-commands.ts for the contract and docs/director-programme-plan.md §4.4.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import { splitAlertSubject, type DirectorConfig, type Segment, type SegmentKind } from "@photonsurge/shared/director";
import { selectNext } from "@photonsurge/shared/director-select";
import type { CommandTarget, ControlOp, DirectorCommand } from "@photonsurge/shared/director-commands";
import { countryShot } from "@photonsurge/shared/director-countries";
import { regionShot } from "@photonsurge/shared/director-regions";
import { resolvePlaceQuery } from "@photonsurge/shared/director-places";
import {
  buildCandidates,
  countryCandidate,
  latestWorldRoundup,
  pointCandidate,
  quakeCandidate,
  regionCandidate,
  stormCandidate,
  volcanoCandidate,
} from "./candidates";
import { countsOf, type SceneRunner } from "./runner";

export type Resolution = { segment: Segment } | { refused: string };

const KIND_WORDS: Partial<Record<SegmentKind, string>> = {
  quake: "earthquake",
  storm: "weather warning",
  volcano: "volcano",
  flight: "notable flight",
  ship: "notable ship",
  ocean: "ocean shot",
  orbital: "satellite shot",
  global: "global spin",
  country: "country",
  region: "area",
  intro: "intro",
};

/** Builders are injectable so the resolution rules can be unit-tested. */
export interface ResolveDeps {
  buildCandidates: typeof buildCandidates;
}
const DEFAULT_DEPS: ResolveDeps = { buildCandidates };

/** Who may land on a city: operators always; viewers per the channel's chat policy. */
export interface ResolveOpts {
  allowCities?: boolean;
}

/** Biggest-population city whose name starts with the query (case-insensitive). */
async function findCity(db: AppDb, query: string) {
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return null;
  const res = await db.cities.getAll(
    { name: { $regex: `^${escaped}`, $options: "i" } },
    { limit: 5, sort: { population: -1 } } as any,
  );
  const rows = ((res as any)?.data ?? []) as { id?: string; name: string; country?: string; lng: number; lat: number }[];
  return rows[0] ?? null;
}

/** A country or area shot by its free-text name. */
async function placeSegment(db: AppDb, cfg: DirectorConfig, query: string): Promise<Segment | null> {
  const match = resolvePlaceQuery(query);
  if (!match) return null;
  return match.kind === "country"
    ? (await countryCandidate(db, cfg, match.shot)).segment
    : (await regionCandidate(db, cfg, match.shot)).segment;
}

async function resolveSegmentId(
  db: AppDb,
  cfg: DirectorConfig,
  r: SceneRunner,
  id: string,
  now: number,
  deps: ResolveDeps,
): Promise<Resolution> {
  const colon = id.indexOf(":");
  const kind = id.slice(0, colon) as SegmentKind;
  const subject = id.slice(colon + 1);
  const missing = { refused: `that ${KIND_WORDS[kind] ?? kind} isn't available any more` };
  switch (kind) {
    case "quake": {
      const q = await db.quakes.get(subject);
      return q ? { segment: quakeCandidate(q, cfg, now).segment } : missing;
    }
    case "storm": {
      const parts = splitAlertSubject(subject);
      const a = parts ? await db.alerts.bySourceIdentifier(parts.source, parts.identifier) : null;
      if (!a) return missing;
      const built = stormCandidate(a, cfg, now);
      return built ? { segment: built.candidate.segment } : { refused: "that warning has no area to frame" };
    }
    case "volcano": {
      const v = await db.volcanoes.get(subject);
      return v ? { segment: volcanoCandidate(v, cfg, now).segment } : missing;
    }
    case "country": {
      const shot = countryShot(subject);
      return shot ? { segment: (await countryCandidate(db, cfg, shot)).segment } : missing;
    }
    case "region": {
      const shot = regionShot(subject);
      return shot ? { segment: (await regionCandidate(db, cfg, shot)).segment } : missing;
    }
    default: {
      // Flights, ships, spins and round-ups only exist as pool members — build
      // that kind's pool (ignoring the channel's kind switches: the operator
      // asked for this one) and look the id up.
      const pool = await deps.buildCandidates(db, { ...cfg, kinds: { ...cfg.kinds, [kind]: true } }, countsOf(r), {
        kinds: [kind],
      });
      const hit = pool.find((c) => c.segment.id === id);
      return hit ? { segment: hit.segment } : missing;
    }
  }
}

/**
 * Resolve a command target to a segment, or a reason it can't air. The
 * operator's own Take ignores the channel's kind switches (they asked for this
 * shot); a `kind` request ("a quake") honours them and picks the one rotation
 * would have picked.
 */
export async function resolveTarget(
  db: AppDb,
  cfg: DirectorConfig,
  r: SceneRunner,
  target: CommandTarget,
  now: number,
  deps: ResolveDeps = DEFAULT_DEPS,
  opts: ResolveOpts = { allowCities: true },
): Promise<Resolution> {
  switch (target.type) {
    case "segment":
      return resolveSegmentId(db, cfg, r, target.id, now, deps);
    case "place": {
      const seg = await placeSegment(db, cfg, target.query);
      if (seg) return { segment: seg };
      if (!opts.allowCities) return { refused: `unknown place "${target.query}"` };
      const city = await findCity(db, target.query);
      return city ? { segment: pointCandidate(city, cfg).segment } : { refused: `unknown place "${target.query}"` };
    }
    case "roundup": {
      if (!target.place) {
        const world = await latestWorldRoundup(db, cfg);
        return world ? { segment: world.segment } : { refused: "no world round-up yet" };
      }
      const match = resolvePlaceQuery(target.place);
      if (!match) return { refused: `unknown place "${target.place}"` };
      const doc =
        match.kind === "country"
          ? await db.countryRoundups.latestForPlace(match.shot.iso2.toLowerCase())
          : await db.regionRoundups.latestForPlace(match.shot.id);
      if (!doc) return { refused: `no round-up for ${match.shot.name} yet` };
      const seg = await placeSegment(db, cfg, match.shot.id);
      return seg ? { segment: { ...seg, leadSlide: "roundup" } } : { refused: `unknown place "${target.place}"` };
    }
    case "kind": {
      if (!cfg.kinds[target.kind]) return { refused: `${KIND_WORDS[target.kind] ?? target.kind}s are off on this channel` };
      const counts = countsOf(r);
      const pool = await deps.buildCandidates(db, cfg, counts, { kinds: [target.kind] });
      const pick = selectNext(pool, {
        history: r.history,
        counts,
        recentCenters: r.recentCenters,
        recentAreasByKind: r.recentAreasByKind,
        geoCooldownDeg: cfg.rotation.geoCooldownDeg,
      });
      return pick ? { segment: pick } : { refused: `no ${KIND_WORDS[target.kind] ?? target.kind} to show right now` };
    }
    case "mapType":
      return { refused: "that request isn't supported yet" };
  }
}

/** Apply a requested hold to a resolved segment (a copy — never mutate a pool member). */
export function withHold(segment: Segment, holdS: number | undefined): Segment {
  return holdS ? { ...segment, holdMs: Math.round(holdS * 1000) } : segment;
}

export interface ControlEffect {
  /** A skip was applied: treat this tick as a shot boundary. */
  boundary: boolean;
  /** A clear was applied: drop every other queued command. */
  clear: boolean;
}

/**
 * Apply one control op to the runner. Pause freezes the current shot (its
 * remaining time is banked and re-applied on resume); hold extends it.
 */
export function applyControl(r: SceneRunner, cmd: DirectorCommand & { cmd: ControlOp }, now: number): ControlEffect {
  const op = cmd.cmd;
  switch (op.op) {
    case "skip":
      return { boundary: true, clear: false };
    case "hold":
      if (r.paused) r.paused.remainingMs += op.extendS * 1000;
      else r.endsAt += op.extendS * 1000;
      return { boundary: false, clear: false };
    case "pause":
      if (!r.paused) r.paused = { since: now, remainingMs: Math.max(0, r.endsAt - now) };
      r.paused.until = op.untilMs;
      return { boundary: false, clear: false };
    case "resume":
      resume(r, now);
      return { boundary: false, clear: false };
    case "clear":
      return { boundary: false, clear: true };
  }
}

/** Unfreeze: the shot gets back the time it had left when paused. */
export function resume(r: SceneRunner, now: number): void {
  if (!r.paused) return;
  r.endsAt = now + r.paused.remainingMs;
  r.paused = undefined;
}

/**
 * Keep a paused shot frozen for this tick: its end slides along with the clock,
 * and a timed pause lifts itself. Returns whether the runner is still paused.
 */
export function holdPaused(r: SceneRunner, now: number): boolean {
  if (!r.paused) return false;
  if (r.paused.until !== undefined && now >= r.paused.until) {
    resume(r, now);
    return false;
  }
  r.endsAt = now + r.paused.remainingMs;
  return true;
}
