/**
 * Auto-director contract — shared by the worker (which runs the director loop),
 * /watch (which cuts to each segment) and /control (which configures it).
 *
 * The director is a "robot operator": each tick it scores live events (severe
 * weather, big quakes, notable flights/ships) plus curated establishing shots,
 * picks the next Segment, and pushes a DirectorState over the socket. A Segment
 * carries a ControlState `patch` (camera + layer preset) which /watch applies
 * exactly like an operator's CONTROL_STATE — so no new rendering is needed, the
 * globe just flies and toggles layers. The `segment` metadata (title/kind/up
 * next/countdown) drives the operator override panel and the on-air graphics.
 *
 * DirectorConfig is the operator's durable control surface: persisted to Mongo
 * by /control via /api/director/config and read by the worker each tick. Same
 * cold-start-from-Mongo pattern as the broadcast ControlState.
 */
import type { ControlState } from "./control";
import type { HazardType } from "./alerts/hazard";
import type { AdMediaType } from "./ads/types";
import type { SummaryPeriod } from "./db/event-summary-model";
import type { SeverityRank } from "./db/alert-model";
import { DEFAULT_DIRECTOR_COUNTRIES, sanitizeDirectorCountries } from "./director-countries";
import { QUAKE_MAGNITUDE_BANDS, quakeMagnitudeClass, type QuakeMagnitudeClass } from "./seismic";

/** Socket event: worker → every browser. The current on-air segment + queue. */
export const DIRECTOR_STATE = "director:state" as const;

/** What kind of thing a segment is showing — also the OBS-scene key (phase 2). */
export type SegmentKind =
  | "intro" // global establishing spin
  | "ocean" // global spin coloured by an ocean field (SST / waves)
  | "tour" // curated region flyover (ambient filler when nothing notable)
  | "country" // an operator-favourited country spotlight (national weather check)
  | "weather" // scalar field over a region of interest
  | "storm" // a severe-weather alert area
  | "quake" // a recent significant earthquake
  | "flight" // a notable aircraft
  | "ship" // a notable vessel
  | "orbital" // a satellite constellation's orbits, spun on a world view
  | "ad" // a full-frame advertisement interstitial (a "commercial break")
  | "summary"; // a generated round-up narrative, read as a lower-third ticker

export const SEGMENT_KINDS: SegmentKind[] = [
  "intro",
  "ocean",
  "orbital",
  "tour",
  "country",
  "weather",
  "storm",
  "quake",
  "flight",
  "ship",
  "ad",
  "summary",
];

export interface DirectorCamera {
  /** [lng, lat] */
  center: [number, number];
  zoom: number;
}

/**
 * One on-air beat. `patch` is merged onto /watch's ControlState (camera + layer
 * toggles) the instant the segment goes live; `id` is stable per subject so the
 * selector can apply a cooldown and not show the same quake twice in a row.
 */
export interface Segment {
  /** Stable id, e.g. "quake:us7000abcd" or "tour:n-atlantic". */
  id: string;
  kind: SegmentKind;
  /** Big on-air label, e.g. "Severe Storm". */
  title: string;
  /** Optional emoji shown before the title (e.g. the hazard glyph 🔥 for a storm). */
  icon?: string;
  /** Smaller context line, e.g. "Gulf of Mexico · Hurricane Warning". */
  subtitle?: string;
  camera: DirectorCamera;
  /** ControlState fields to assert while this segment is on air. */
  patch: Partial<ControlState>;
  /** How long to hold this shot, in ms. */
  holdMs: number;
  /**
   * For `storm` segments: the classified hazard behind the alert. Drives the
   * per-hazard map plan (which fields cycle + how long) via hazardMapPlan — a
   * heat warning reads through humidity/temp, a tornado through CAPE/radar/gust.
   */
  hazard?: HazardType;
  /**
   * For `quake` segments: the USGS tsunami flag. When set, the shot reads the
   * ocean story (sst → wave) instead of the neutral land backdrop (temp → sst) —
   * see quakeMapPlan. No weather field is meteorologically relevant to a quake,
   * so the map is a backdrop, never a forecast.
   */
  tsunami?: boolean;
  /**
   * For `quake` segments: the raw seismic numbers behind the card, carried so the
   * on-air + operator QuakeReport panels can classify magnitude/depth and frame
   * the nearest cities without re-fetching or string-parsing the detail rows.
   */
  quake?: { mag: number; depthKm: number };
  /** Kind-specific detail rows for the operator info box (severity, depth, …). */
  details?: { label: string; value: string }[];
  /**
   * For `flight`/`ship` segments: rich identity for the on-air Track Info card —
   * photo + story + type/operator. Present when the craft matched the notable
   * catalog (photo/story) or the aircraftMeta cache (type/operator). Rides on the
   * segment, so it reaches /watch over the existing director socket with no extra
   * plumbing. See TrackInfo.
   */
  trackInfo?: TrackInfo;
  /**
   * For `ad` segments: the advertisement to display full-frame. Rides on the
   * segment (like trackInfo) so /watch renders the ad interstitial straight from
   * the director cut — no ad fetch on the client. See SegmentAd.
   */
  ad?: SegmentAd;
  /**
   * For `summary` segments: the generated round-up narrative to read as a
   * lower-third ticker. Rides on the segment (like `ad`) so /watch renders it
   * straight from the director cut — no extra fetch. See SegmentSummary.
   */
  summary?: SegmentSummary;
}

/**
 * The advertisement a full-frame `ad` interstitial shows, attached to its
 * segment by the worker. `mediaUrl` is the ready-to-use, cache-busted serve URL
 * (`/api/ads/<id>/media?v=…`) so the client just drops it into an <img>/<video>.
 */
export interface SegmentAd {
  adId: string;
  title: string;
  mediaType: AdMediaType;
  mediaUrl: string;
  advertiser?: string;
  clickUrl?: string;
}

/**
 * The round-up narrative a `summary` segment reads out, attached to its segment
 * by the worker (see worker/src/director/candidates.ts `summaryCandidates`).
 * `id` is the source EventSummary doc id — used to avoid re-airing the same
 * round-up twice in a session.
 */
export interface SegmentSummary {
  id: string;
  period: SummaryPeriod;
  narrative: string;
  /** ISO timestamp the round-up was generated. */
  generatedAt: string;
  /**
   * Places the round-up touches on, in narrative order — the client flies the
   * camera to each in turn and shows a small info card (place/hazard/severity)
   * alongside the ticker. Empty when the round-up's stats/topEvents carried no
   * coordinates (camera stays on the global view).
   */
  stops?: SegmentSummaryStop[];
}

/**
 * One camera stop within a `summary` segment's round-up tour, sourced from the
 * EventSummary doc's `hotspots`/`topEvents` (see worker/src/director/candidates.ts
 * `summaryCandidates`). Drives both the camera fly-to and the on-air info card.
 */
export interface SegmentSummaryStop {
  /** Place/cluster label, e.g. "Southern Europe" or a specific alert title. */
  label: string;
  /** Secondary line, e.g. hazard type or event count. */
  subtitle?: string;
  lng: number;
  lat: number;
  severity: SeverityRank;
}

/**
 * Rich on-air identity for an aircraft/ship, attached to its segment. Everything
 * optional — a craft with no catalog match still carries whatever the live snapshot
 * + aircraftMeta cache know. `notable`/`vip` drive on-air emphasis (a VIP such as
 * Air Force One is the top tier).
 */
export interface TrackInfo {
  /** Catalog display name, e.g. "Air Force One". */
  label?: string;
  /** Catalog grouping, e.g. "government" | "research" | "cruise". */
  category?: string;
  /** Photo URL (planespotters airframe shot, else the Wikipedia lead image). */
  photoUrl?: string;
  /** Photographer credit (planespotters requires attribution). */
  photoCredit?: string;
  /** Link back to the photo page. */
  photoLink?: string;
  /** Aircraft type / vessel type, e.g. "Boeing VC-25A". */
  type?: string;
  operator?: string;
  registration?: string;
  flag?: string;
  country?: string;
  /** Short Wikipedia blurb. */
  extract?: string;
  /** Matched the curated notable-tracks catalog. */
  notable?: boolean;
  /** Top-tier VIP (e.g. Air Force One). */
  vip?: boolean;
}

/**
 * Live director state pushed to /watch. Emitted on every cut and on a heartbeat
 * (same `seq`) so a freshly-loaded /watch can join mid-segment. /watch only
 * flies the camera when `seq` changes — heartbeats just refresh the countdown.
 */
export interface DirectorState {
  /** Which scene/output this director drives (matches a scene / /watch id). */
  sceneId: string;
  /** Monotonic cut counter. A change means "this is a new shot — fly to it". */
  seq: number;
  /** Whether the director is currently driving (false when mode is "off"). */
  active: boolean;
  segment: Segment | null;
  /** Wall-clock ms when the current segment started / will end. */
  startedAt: number;
  endsAt: number;
  /** Titles of the next few queued segments — for a "coming up" rail. */
  upNext: { kind: SegmentKind; title: string }[];
  /**
   * Wall-clock ms this exact segment last aired earlier in the session, or
   * undefined if it's the first time. Operator-only readout ("last shown 4m
   * ago") to spot a location/mode recurring too often — not shown on /watch.
   */
  lastShownAt?: number;
  /** How many times this exact segment has aired this session (incl. now). */
  timesShown?: number;
}

export type DirectorMode = "off" | "auto";

/**
 * Storm hold levels — one named tier per normalised alert severityRank (0–4),
 * so the operator can dwell on an Extreme warning far longer than a Minor one.
 * Named keys (not the numeric rank) so the Mongo doc reads as prose and can
 * never be mistaken for an array. Strongest first, matching the UI order.
 */
export const STORM_LEVELS = [
  { key: "extreme", rank: 4, label: "Extreme" },
  { key: "severe", rank: 3, label: "Severe" },
  { key: "moderate", rank: 2, label: "Moderate" },
  { key: "minor", rank: 1, label: "Minor" },
  { key: "info", rank: 0, label: "None / info" },
] as const;

export type StormLevel = (typeof STORM_LEVELS)[number]["key"];

/** Bucket a normalised alert severityRank (0–4) into its hold level. */
export function stormLevelForRank(rank: number): StormLevel {
  const hit = STORM_LEVELS.find((l) => rank >= l.rank);
  return (hit ?? STORM_LEVELS[STORM_LEVELS.length - 1]).key;
}

/** Ordered quake hold levels (strongest first) — the magnitude classes on air. */
export const QUAKE_LEVELS: QuakeMagnitudeClass[] = QUAKE_MAGNITUDE_BANDS.map((b) => b.cls);

/**
 * Operator-set, durable director configuration. Persisted to Mongo; the worker
 * re-reads it every tick so changes take effect within one tick with no socket
 * plumbing in the operator→worker direction.
 */
export interface DirectorConfig {
  mode: DirectorMode;
  /**
   * Hold per segment KIND, seconds — every action type gets its own duration.
   * For the event kinds this is only the fallback: `quake` and `storm` shots
   * take their hold from the per-level maps below instead, so an Extreme
   * warning can dwell far longer than a Minor one.
   */
  kindHoldSeconds: Record<SegmentKind, number>;
  /** Hold per quake magnitude class (micro … great), seconds. */
  quakeHoldSeconds: Record<QuakeMagnitudeClass, number>;
  /** Hold per storm severity level (info … extreme), seconds. */
  stormHoldSeconds: Record<StormLevel, number>;
  /**
   * Fixed camera-flight time between shots, seconds — the "set" transition. The
   * worker stamps `holdMs`→hold and this→`cutTransitionMs` on every cut, so each
   * shot flies in for the same deliberate pace regardless of travel distance.
   */
  transitionSeconds: number;
  /** Which kinds are eligible to be scheduled. */
  kinds: Record<SegmentKind, boolean>;
  /**
   * Favourite country ids (see COUNTRY_SHOTS) the `country` kind rotates
   * through — the operator's "channels we cover" list. Catalog-ordered.
   */
  countries: string[];
  /** Only schedule quakes at/above this magnitude. */
  minQuakeMag: number;
  /** Only schedule storms at/above this normalised severity (0–4). */
  minAlertSeverity: number;
  /**
   * When the `ad` kind is enabled, force a full-frame ad interstitial every this
   * many shots (a "commercial break" cadence). Min 1. Ignored when `kinds.ad`
   * is off. A random ACTIVE ad is picked (weighted by its `weight`) each time.
   */
  adEveryNShots: number;
  /**
   * Bump to force-cut the current segment immediately. The worker remembers the
   * last value it acted on; any increase skips. (Monotonic, operator-driven.)
   */
  skipNonce: number;
  /**
   * Which basemap/"map type" looks each touring kind (intro/ocean/quake) cycles
   * through, by id (see GlobalMapType.id in director-rois). A kind absent here,
   * or given an empty list, tours its full catalog (today's behaviour) — this is
   * purely a subtractive filter, never additive.
   */
  mapTypes: Partial<Record<SegmentKind, string[]>>;
  /**
   * Per-kind boolean overlay overrides layered onto PRESETS[kind] (see
   * OVERLAY_KEYS in director-rois) — e.g. turn off a quake's plate-boundary
   * overlay without touching any other kind. Empty = today's PRESETS untouched.
   */
  overlayOverrides: Partial<Record<SegmentKind, Partial<Record<string, boolean>>>>;
}

/**
 * Default hold per kind. The world spins (intro/ocean/orbital) run long — they
 * tour several map types within the one shot (was the old holdSeconds × 1.4).
 */
export const DEFAULT_KIND_HOLD_SECONDS: Record<SegmentKind, number> = {
  intro: 17,
  ocean: 17,
  orbital: 17,
  tour: 12,
  country: 12,
  weather: 12,
  storm: 12,
  quake: 12,
  flight: 12,
  ship: 12,
  ad: 12,
  /** Floor only — actual hold scales with the narrative's reading time (see
   *  summaryCandidates), capped separately at 60s. */
  summary: 20,
};

/** Default hold per quake magnitude class — the bigger the quake, the longer the dwell. */
export const DEFAULT_QUAKE_HOLD_SECONDS: Record<QuakeMagnitudeClass, number> = {
  micro: 8,
  minor: 8,
  light: 10,
  moderate: 12,
  strong: 16,
  major: 22,
  great: 30,
};

/** Default hold per storm severity level — Extreme headlines linger. */
export const DEFAULT_STORM_HOLD_SECONDS: Record<StormLevel, number> = {
  info: 10,
  minor: 10,
  moderate: 12,
  severe: 16,
  extreme: 24,
};

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  mode: "off",
  kindHoldSeconds: DEFAULT_KIND_HOLD_SECONDS,
  quakeHoldSeconds: DEFAULT_QUAKE_HOLD_SECONDS,
  stormHoldSeconds: DEFAULT_STORM_HOLD_SECONDS,
  transitionSeconds: 4,
  kinds: {
    intro: true,
    ocean: true,
    orbital: true,
    tour: true,
    country: true,
    weather: true,
    storm: true,
    quake: true,
    flight: true,
    ship: true,
    // Off by default: ads only air once the operator enables them (and has
    // uploaded some). Opt-in, like a paid feature should be.
    ad: false,
    // On by default: free, auto-generated content — nothing to upload/configure
    // (a summary with no successful narrative just never produces a candidate).
    summary: true,
  },
  countries: DEFAULT_DIRECTOR_COUNTRIES,
  minQuakeMag: 4.5,
  minAlertSeverity: 3,
  adEveryNShots: 6,
  skipNonce: 0,
  mapTypes: {},
  overlayOverrides: {},
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * Merge a partial hold map (untrusted) onto a base — unknown keys dropped,
 * non-numbers ignored, and every hold clamped to the same 3s floor as before.
 */
function mergeHolds<K extends string>(
  keys: readonly K[],
  base: Record<K, number>,
  patch: Partial<Record<K, number>> | undefined,
): Record<K, number> {
  const out = { ...base };
  if (patch) {
    for (const k of keys) {
      const v = patch[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(3, v);
    }
  }
  return out;
}

/**
 * Merge a per-kind string-array map (untrusted) onto a base — unknown kinds
 * dropped, non-string-array values ignored. Used for `mapTypes`.
 */
function mergeStringArrayMap(
  base: Partial<Record<SegmentKind, string[]>>,
  patch: Partial<Record<SegmentKind, string[]>> | undefined,
): Partial<Record<SegmentKind, string[]>> {
  const out = { ...base };
  if (patch) {
    for (const k of SEGMENT_KINDS) {
      const v = patch[k];
      if (Array.isArray(v) && v.every((id) => typeof id === "string")) out[k] = v;
    }
  }
  return out;
}

/**
 * Merge a per-kind boolean-map map (untrusted) onto a base — unknown kinds
 * dropped, non-boolean values ignored, each kind's inner map merged (not
 * replaced) so a single-toggle patch doesn't wipe its siblings. Used for
 * `overlayOverrides`.
 */
function mergeBoolMapMap(
  base: Partial<Record<SegmentKind, Partial<Record<string, boolean>>>>,
  patch: Partial<Record<SegmentKind, Partial<Record<string, boolean>>>> | undefined,
): Partial<Record<SegmentKind, Partial<Record<string, boolean>>>> {
  const out = { ...base };
  if (patch) {
    for (const k of SEGMENT_KINDS) {
      const inner = patch[k];
      if (!inner || typeof inner !== "object") continue;
      const cur = { ...(out[k] ?? {}) };
      for (const key of Object.keys(inner)) {
        const v = inner[key];
        if (typeof v === "boolean") cur[key] = v;
      }
      out[k] = cur;
    }
  }
  return out;
}

/**
 * Merge a partial (possibly untrusted, from HTTP) director-config patch onto a
 * base. Pure — used by the API route and unit-tested. Mirrors mergeControlState.
 */
export function mergeDirectorConfig(
  base: DirectorConfig,
  patch: Partial<DirectorConfig>,
): DirectorConfig {
  const kinds = { ...base.kinds };
  if (patch.kinds) {
    for (const k of SEGMENT_KINDS) {
      if (typeof patch.kinds[k] === "boolean") kinds[k] = patch.kinds[k] as boolean;
    }
  }
  return {
    mode: patch.mode === "off" || patch.mode === "auto" ? patch.mode : base.mode,
    kindHoldSeconds: mergeHolds(SEGMENT_KINDS, base.kindHoldSeconds, patch.kindHoldSeconds),
    quakeHoldSeconds: mergeHolds(QUAKE_LEVELS, base.quakeHoldSeconds, patch.quakeHoldSeconds),
    stormHoldSeconds: mergeHolds(
      STORM_LEVELS.map((l) => l.key),
      base.stormHoldSeconds,
      patch.stormHoldSeconds,
    ),
    transitionSeconds: Math.max(0.5, num(patch.transitionSeconds, base.transitionSeconds)),
    kinds,
    countries: sanitizeDirectorCountries(patch.countries) ?? base.countries,
    minQuakeMag: num(patch.minQuakeMag, base.minQuakeMag),
    minAlertSeverity: num(patch.minAlertSeverity, base.minAlertSeverity),
    adEveryNShots: Math.max(1, Math.round(num(patch.adEveryNShots, base.adEveryNShots))),
    skipNonce: num(patch.skipNonce, base.skipNonce),
    mapTypes: mergeStringArrayMap(base.mapTypes, patch.mapTypes),
    overlayOverrides: mergeBoolMapMap(base.overlayOverrides, patch.overlayOverrides),
  };
}

/** Configured hold for a segment kind, in ms. */
export function kindHoldMs(cfg: DirectorConfig, kind: SegmentKind): number {
  return Math.round(num(cfg.kindHoldSeconds?.[kind], DEFAULT_KIND_HOLD_SECONDS[kind]) * 1000);
}

/** Configured hold for a quake of this magnitude, in ms (per magnitude class). */
export function quakeHoldMs(cfg: DirectorConfig, mag: number): number {
  const cls = quakeMagnitudeClass(mag);
  return Math.round(num(cfg.quakeHoldSeconds?.[cls], DEFAULT_QUAKE_HOLD_SECONDS[cls]) * 1000);
}

/** Configured hold for a storm alert of this severityRank, in ms (per level). */
export function stormHoldMs(cfg: DirectorConfig, severityRank: number): number {
  const level = stormLevelForRank(severityRank);
  return Math.round(num(cfg.stormHoldSeconds?.[level], DEFAULT_STORM_HOLD_SECONDS[level]) * 1000);
}

export const INITIAL_DIRECTOR_STATE: DirectorState = {
  sceneId: "default",
  seq: 0,
  active: false,
  segment: null,
  startedAt: 0,
  endsAt: 0,
  upNext: [],
};
