/**
 * What a scheduled video asks about its scope at the front of the render
 * queue (docs/short-video-plan.md §8):
 *
 *  • `auto` scope — the country or area with the highest summed event score,
 *    skipping the places this schedule's last few videos were made of;
 *  • `skipIfQuiet` — is anything of the included kinds active in the scope?
 *
 * Scoring uses the director's own candidate scores (storm 50 + 12·severity,
 * quake 40 + 10·magnitude, volcano 50 + 12·level). For `auto` the whole planet
 * is read ONCE and each event is attributed to places: an alert by the country
 * its source encodes (alerts are read without their polygons — a whole-planet
 * marine polygon must never be parsed just to be counted), a quake or volcano
 * by its point inside the place's box.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import type { DirectorConfig } from "@photonsurge/shared/director";
import { COUNTRY_SHOTS } from "@photonsurge/shared/director-countries";
import { REGION_SHOTS } from "@photonsurge/shared/director-regions";
import { memberCountryCodes } from "@photonsurge/shared/region-membership";
import { alertCountryCode } from "@photonsurge/shared/alerts/country";
import type { ShortAutoScope } from "@photonsurge/shared/short-render";
import type { ShortInclude, ShortScope } from "@photonsurge/shared/short-script";
import { quakeCandidate, volcanoCandidate } from "./builders";
import { resolveScope, scopeQuakes, scopeVolcanoes } from "./script-scope";
import { isRoundupOnly, scopeEvents } from "./script-template";

type Bbox = [number, number, number, number];

/** One active event, as `auto` scores it. `cc` lowercase ISO-2. */
export interface ActivityItem {
  score: number;
  cc?: string;
  point?: [number, number];
}

/** A place `auto` can pick. */
export interface AutoCandidate {
  scope: { type: "country" | "area"; id: string };
  name: string;
  bbox: Bbox;
  /** Countries (lowercase ISO-2) whose alerts count for it. */
  members: Set<string>;
}

const inBbox = ([lng, lat]: [number, number], [w, s, e, n]: Bbox): boolean =>
  lat >= s && lat <= n && (w <= e ? lng >= w && lng <= e : lng >= w || lng <= e);

/** Every switch on: `auto` for a round-up-only video still picks by what's going on. */
const ALL_KINDS: ShortInclude = { alerts: true, quakes: true, volcanoes: true };

/** The kinds `auto` scores by: the video's switches, or all of them for a round-up-only video. */
export const autoScoringKinds = (include: ShortInclude): ShortInclude => (isRoundupOnly(include) ? ALL_KINDS : include);

/**
 * PURE: the candidate with the highest summed score, skipping `exclude`
 * (scope ids). Ties keep catalog order. Null when no other place has anything
 * active.
 */
export function pickAutoPlace(
  items: ActivityItem[],
  candidates: AutoCandidate[],
  exclude: Set<string>,
): { candidate: AutoCandidate; score: number } | null {
  let best: { candidate: AutoCandidate; score: number } | null = null;
  for (const c of candidates) {
    if (exclude.has(c.scope.id)) continue;
    let score = 0;
    for (const it of items) {
      if ((it.cc && c.members.has(it.cc)) || (it.point && inBbox(it.point, c.bbox))) score += it.score;
    }
    if (score > 0 && (!best || score > best.score)) best = { candidate: c, score };
  }
  return best;
}

/** The places `auto` chooses among, with what attributes an event to each. */
export async function autoCandidates(db: AppDb, of: ShortAutoScope["of"]): Promise<AutoCandidate[]> {
  if (of === "country") {
    return COUNTRY_SHOTS.map((s) => ({
      scope: { type: "country" as const, id: s.id },
      name: s.name,
      bbox: s.bbox as Bbox,
      members: new Set([s.iso2.toLowerCase()]),
    }));
  }
  // Continents take their members from the Country catalog.
  const catalog = await db.countries.list().catch(() => []);
  return REGION_SHOTS.map((s) => ({
    scope: { type: "area" as const, id: s.id },
    name: s.name,
    bbox: s.bbox,
    members: new Set(memberCountryCodes(s.id, catalog)),
  }));
}

/** Everything active on the planet of the given kinds, scored. One read per kind. */
export async function planetActivity(db: AppDb, cfg: DirectorConfig, include: ShortInclude, now: number): Promise<ActivityItem[]> {
  const out: ActivityItem[] = [];
  const globe = { type: "globe" } as const;
  if (include.alerts) {
    const light = (await db.alerts.list({ activeOnly: true, severityMin: cfg.minAlertSeverity, omitCoordinates: true, lean: true })) as any[];
    for (const a of light) {
      const info = Array.isArray(a.info) ? a.info[0] : undefined;
      if (!info?.area?.[0]?.geometry?.type) continue; // geocode-only: nothing the video could frame
      const cc = alertCountryCode(a)?.toLowerCase();
      if (!cc) continue;
      const sev = typeof a.maxSeverityRank === "number" ? a.maxSeverityRank : info?.severityRank ?? 0;
      out.push({ score: 50 + sev * 12, cc });
    }
  }
  if (include.quakes) {
    for (const q of await scopeQuakes(db, cfg, globe, now)) out.push({ score: quakeCandidate(q, cfg, now).score, point: [q.lng, q.lat] });
  }
  if (include.volcanoes) {
    for (const v of await scopeVolcanoes(db, globe)) {
      const cand = volcanoCandidate(v, cfg, now);
      if (cand) out.push({ score: cand.score, point: [v.lng, v.lat] });
    }
  }
  return out;
}

/**
 * Resolve `auto` to a place: the busiest country or area of the kinds the
 * video scores by, not one of `exclude`. Null when nowhere else has anything
 * active.
 */
export async function resolveAutoScope(
  db: AppDb,
  cfg: DirectorConfig,
  auto: ShortAutoScope,
  include: ShortInclude,
  exclude: Set<string>,
  now: number,
): Promise<{ scope: ShortScope; name: string; score: number } | null> {
  const [items, candidates] = await Promise.all([planetActivity(db, cfg, autoScoringKinds(include), now), autoCandidates(db, auto.of)]);
  const best = pickAutoPlace(items, candidates, exclude);
  return best ? { scope: best.candidate.scope, name: best.candidate.name, score: best.score } : null;
}

/** Is anything of the included kinds active in the scope? (`skipIfQuiet`.) */
export async function scopeHasActivity(db: AppDb, cfg: DirectorConfig, scope: ShortScope, include: ShortInclude, now: number): Promise<boolean> {
  const rs = await resolveScope(db, scope);
  return (await scopeEvents(db, cfg, rs, include, now)).length > 0;
}
