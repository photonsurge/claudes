/**
 * Director templates — starting points per kind of stream. Applying one stages
 * its values into the admin draft (the operator still saves); a channel never
 * stays linked to a template, so editing a template later changes no channel.
 *
 * A template covers content, pacing and pools only. It never touches a
 * channel's looks and slides (`kindLooks`, `kindSlides`, `activeSlideId`), its
 * break-in rules, or the live controls (`mode`, `skipNonce`).
 *
 * See docs/director-programme-plan.md §7.3.
 */
import {
  DEFAULT_DIRECTOR_CONFIG,
  DEFAULT_KIND_HOLD_SECONDS,
  type DirectorConfig,
  type SegmentKind,
} from "./director";
import { DEFAULT_DIRECTOR_POOLS, DEFAULT_DIRECTOR_TEMPO, DEFAULT_DIRECTOR_TOURS } from "./director-tuning";

/** The DirectorConfig keys a template may set. */
export const TEMPLATE_KEYS = [
  "kinds",
  "kindWeights",
  "kindHoldSeconds",
  "minQuakeMag",
  "minAlertSeverity",
  "adEveryNShots",
  "pools",
  "tours",
  "tempo",
] as const satisfies readonly (keyof DirectorConfig)[];
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Keys never copied from another channel: its live controls, per-session
 *  state and its scripted-short play trigger. */
export const COPY_EXCLUDED_KEYS = ["mode", "skipNonce", "activeSlideId", "script"] as const satisfies readonly (keyof DirectorConfig)[];

export type DirectorTemplateId = "maps" | "events" | "ocean" | "full";

export interface DirectorTemplate {
  id: DirectorTemplateId;
  label: string;
  /** One line for the picker. */
  blurb: string;
  /** Complete objects for every key it sets (the draft stages whole objects). */
  config: Pick<DirectorConfig, TemplateKey>;
}

const ALL_OFF = Object.fromEntries(Object.keys(DEFAULT_DIRECTOR_CONFIG.kinds).map((k) => [k, false])) as Record<SegmentKind, boolean>;
const only = (...on: SegmentKind[]): Record<SegmentKind, boolean> => ({
  ...ALL_OFF,
  ...Object.fromEntries(on.map((k) => [k, true])),
});
const holds = (patch: Partial<Record<SegmentKind, number>>): Record<SegmentKind, number> => ({ ...DEFAULT_KIND_HOLD_SECONDS, ...patch });

const full: DirectorTemplate["config"] = {
  kinds: DEFAULT_DIRECTOR_CONFIG.kinds,
  kindWeights: DEFAULT_DIRECTOR_CONFIG.kindWeights,
  kindHoldSeconds: DEFAULT_DIRECTOR_CONFIG.kindHoldSeconds,
  minQuakeMag: DEFAULT_DIRECTOR_CONFIG.minQuakeMag,
  minAlertSeverity: DEFAULT_DIRECTOR_CONFIG.minAlertSeverity,
  adEveryNShots: DEFAULT_DIRECTOR_CONFIG.adEveryNShots,
  pools: DEFAULT_DIRECTOR_POOLS,
  tours: DEFAULT_DIRECTOR_TOURS,
  tempo: DEFAULT_DIRECTOR_TEMPO,
};

export const DIRECTOR_TEMPLATES: Record<DirectorTemplateId, DirectorTemplate> = {
  maps: {
    id: "maps",
    label: "Maps",
    blurb: "The world, the oceans and space — no events, long holds, slow map changes.",
    config: {
      ...full,
      kinds: only("intro", "global", "ocean", "orbital"),
      kindWeights: {},
      kindHoldSeconds: holds({ intro: 90, global: 90, ocean: 90, orbital: 90 }),
      tempo: { ...DEFAULT_DIRECTOR_TEMPO, mapStepS: 10 },
    },
  },
  events: {
    id: "events",
    label: "Events",
    blurb: "Storms, quakes, volcanoes, flights and ships, with short world bridges between them.",
    config: {
      ...full,
      kinds: only("global", "storm", "quake", "volcano", "flight", "ship"),
      kindWeights: { global: 0.5 },
      kindHoldSeconds: holds({ global: 10 }),
      minQuakeMag: 5,
      minAlertSeverity: 3,
    },
  },
  ocean: {
    id: "ocean",
    label: "Ocean",
    blurb: "The oceans first, with space and the world between — long dwells, a slow depth cycle.",
    config: {
      ...full,
      kinds: only("ocean", "orbital", "global"),
      kindWeights: { ocean: 3 },
      kindHoldSeconds: holds({ ocean: 60, orbital: 30, global: 20 }),
      tours: { ...DEFAULT_DIRECTOR_TOURS, stopDwellS: 60 },
      tempo: { ...DEFAULT_DIRECTOR_TEMPO, depthCycleS: 4 },
    },
  },
  full: {
    id: "full",
    label: "Full feed",
    blurb: "Everything, at today's defaults.",
    config: full,
  },
};

export const DIRECTOR_TEMPLATE_LIST: readonly DirectorTemplate[] = [
  DIRECTOR_TEMPLATES.full,
  DIRECTOR_TEMPLATES.maps,
  DIRECTOR_TEMPLATES.events,
  DIRECTOR_TEMPLATES.ocean,
];

/** Plain-data deep copy (configs are JSON; jsdom has no structuredClone). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A template's values as a draft patch (copies — the template tables stay untouched). */
export function templatePatch(id: DirectorTemplateId): Pick<DirectorConfig, TemplateKey> {
  return clone(DIRECTOR_TEMPLATES[id].config);
}

/**
 * The keys a template would change on a channel, for the confirm ("this
 * replaces: Kinds, Holds, …"). Compared by value.
 */
export function templateChanges(cfg: DirectorConfig, id: DirectorTemplateId): TemplateKey[] {
  const t = DIRECTOR_TEMPLATES[id].config;
  return TEMPLATE_KEYS.filter((k) => JSON.stringify(cfg[k]) !== JSON.stringify(t[k]));
}

/** Another channel's config as a draft patch: everything but its live controls. */
export function copyablePatch(source: DirectorConfig): Partial<DirectorConfig> {
  const out = clone(source) as unknown as Record<string, unknown>;
  for (const k of COPY_EXCLUDED_KEYS) delete out[k];
  return out as Partial<DirectorConfig>;
}
