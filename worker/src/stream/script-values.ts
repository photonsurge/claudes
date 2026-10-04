/**
 * The values a video's title codes resolve to (`%{place}`, `%{headline}`…,
 * docs/short-video-plan.md §6.8), computed once and stamped on the script
 * (`ShortScript.values`) so the editor can preview a title with real values and
 * the render resolves it without recomputing anything. `%{duration}` and the
 * date codes are filled at render time, not here; `%{n}` belongs to schedules
 * (WP9) and is left out.
 *
 * Stamped at the front of the render queue right after generate (the generate
 * path itself is being rewritten by the formats branch, WP5 — once it lands,
 * generate can call `scriptValues` itself).
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import type { iPlaceRoundupModel } from "@photonsurge/shared/db/place-roundup-model";
import { countryShot } from "@photonsurge/shared/director-countries";
import { regionShot } from "@photonsurge/shared/director-regions";
import type { ShortScript } from "@photonsurge/shared/short-script";
import { VIDEO_TEXT_TIMEZONE } from "@photonsurge/shared/video-text";
import { log } from "@photonsurge/shared/utill/logger";
import { roundupText } from "../director/script-template";
import { sceneDirectorConfig } from "../director/script-generate";
import { resolveScope, scopeAlerts, scopeQuakes, scopeVolcanoes } from "../director/script-scope";
import { sceneForScript } from "./script-scene";

const TAG = "script-values";

const KIND_WORDS = { alerts: "alerts", quakes: "earthquakes", volcanoes: "volcanoes" } as const;
const EVENT_PREFIX = { alerts: "storm:", quakes: "quake:", volcanoes: "volcano:" } as const;

const listWords = (words: string[]): string =>
  words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

/** "1:45" — a video's length as YouTube shows one. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The first sentence of a text ("" for none). */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : t).trim();
}

/** "round-up" · "alerts and earthquakes". */
export function kindOf(include: ShortScript["include"]): string {
  const kinds = (Object.keys(KIND_WORDS) as (keyof typeof KIND_WORDS)[]).filter((k) => include[k]);
  return kinds.length ? listWords(kinds.map((k) => KIND_WORDS[k])) : "round-up";
}

/** "06:00" in `timeZone` (London until a place time zone is available). */
const hhmm = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/**
 * Compute a script's title-code values. Never throws: a value that can't be
 * read (no round-up, a Mongo hiccup) is left empty, which the resolver turns
 * into "".
 */
export async function scriptValues(
  db: AppDb,
  script: Pick<ShortScript, "scope" | "include" | "clips"> & { formatId?: string },
  opts: { formatName?: string; now?: number } = {},
): Promise<Record<string, string>> {
  const now = opts.now ?? Date.now();
  const v: Record<string, string> = { kind: kindOf(script.include), places: "1" };
  if (opts.formatName) v.format = opts.formatName;

  let roundup: iPlaceRoundupModel | null = null;
  const scope = script.scope;
  if (scope.type === "globe") {
    v.place = "World";
    v.placeId = "world";
  } else if (scope.type === "country") {
    const shot = countryShot(scope.id);
    v.place = shot?.name ?? scope.id;
    v.placeId = scope.id;
    if (shot?.flag) v.flag = shot.flag;
    if (shot) roundup = await db.countryRoundups.latestForPlace(shot.iso2.toLowerCase()).catch(() => null);
  } else {
    const shot = regionShot(scope.id);
    v.place = shot?.name ?? scope.id;
    v.placeId = scope.id;
    if (shot) roundup = await db.regionRoundups.latestForPlace(shot.id).catch(() => null);
  }
  if (roundup) {
    const text = roundupText(roundup);
    if (text) v.roundup = text;
    const headline = firstSentence(roundup.summary?.trim() || text);
    if (headline) v.headline = headline;
    // TODO(place time zone): §6.8 wants asOf local to the place; no per-place
    // zone is stored yet, so it is London time like the date codes' default.
    if (roundup.generatedAt) v.asOf = hhmm(new Date(roundup.generatedAt), VIDEO_TEXT_TIMEZONE);
  }

  // Event counts: the scope's active events (the template's own filters) for a
  // country or area; the globe counts its clips instead — scanning every active
  // alert polygon on the planet for a title is not worth it.
  try {
    if (scope.type === "globe") {
      for (const k of Object.keys(EVENT_PREFIX) as (keyof typeof EVENT_PREFIX)[]) {
        v[k] = String(script.clips.filter((c) => c.target.startsWith(EVENT_PREFIX[k])).length);
      }
    } else {
      const rs = await resolveScope(db, scope);
      const cfg = await sceneDirectorConfig(db, sceneForScript(script), true);
      const [alerts, quakes, volcanoes] = await Promise.all([
        scopeAlerts(db, cfg, rs),
        scopeQuakes(db, cfg, rs, now),
        scopeVolcanoes(db, rs),
      ]);
      v.alerts = String(alerts.length);
      v.quakes = String(quakes.length);
      v.volcanoes = String(volcanoes.length);
    }
  } catch (err) {
    log(TAG, `event counts unavailable`, String((err as Error)?.message ?? err));
  }

  const top = script.clips.find((c) => Object.values(EVENT_PREFIX).some((p) => c.target.startsWith(p)));
  if (top?.label?.title) v.top = top.label.title;
  return v;
}
