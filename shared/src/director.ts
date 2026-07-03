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

/** Socket event: worker → every browser. The current on-air segment + queue. */
export const DIRECTOR_STATE = "director:state" as const;

/** What kind of thing a segment is showing — also the OBS-scene key (phase 2). */
export type SegmentKind =
  | "intro" // global establishing spin
  | "ocean" // global spin coloured by an ocean field (SST / waves)
  | "tour" // curated region flyover (ambient filler when nothing notable)
  | "weather" // scalar field over a region of interest
  | "storm" // a severe-weather alert area
  | "quake" // a recent significant earthquake
  | "flight" // a notable aircraft
  | "ship" // a notable vessel
  | "orbital" // a satellite constellation's orbits, spun on a world view
  | "ad"; // a full-frame advertisement interstitial (a "commercial break")

export const SEGMENT_KINDS: SegmentKind[] = [
  "intro",
  "ocean",
  "orbital",
  "tour",
  "weather",
  "storm",
  "quake",
  "flight",
  "ship",
  "ad",
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
 * Operator-set, durable director configuration. Persisted to Mongo; the worker
 * re-reads it every tick so changes take effect within one tick with no socket
 * plumbing in the operator→worker direction.
 */
export interface DirectorConfig {
  mode: DirectorMode;
  /** Default hold per segment, seconds (event kinds may extend this). */
  holdSeconds: number;
  /**
   * Fixed camera-flight time between shots, seconds — the "set" transition. The
   * worker stamps `holdMs`→hold and this→`cutTransitionMs` on every cut, so each
   * shot flies in for the same deliberate pace regardless of travel distance.
   */
  transitionSeconds: number;
  /** Which kinds are eligible to be scheduled. */
  kinds: Record<SegmentKind, boolean>;
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
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  mode: "off",
  holdSeconds: 12,
  transitionSeconds: 4,
  kinds: {
    intro: true,
    ocean: true,
    orbital: true,
    tour: true,
    weather: true,
    storm: true,
    quake: true,
    flight: true,
    ship: true,
    // Off by default: ads only air once the operator enables them (and has
    // uploaded some). Opt-in, like a paid feature should be.
    ad: false,
  },
  minQuakeMag: 4.5,
  minAlertSeverity: 3,
  adEveryNShots: 6,
  skipNonce: 0,
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

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
    holdSeconds: Math.max(3, num(patch.holdSeconds, base.holdSeconds)),
    transitionSeconds: Math.max(0.5, num(patch.transitionSeconds, base.transitionSeconds)),
    kinds,
    minQuakeMag: num(patch.minQuakeMag, base.minQuakeMag),
    minAlertSeverity: num(patch.minAlertSeverity, base.minAlertSeverity),
    adEveryNShots: Math.max(1, Math.round(num(patch.adEveryNShots, base.adEveryNShots))),
    skipNonce: num(patch.skipNonce, base.skipNonce),
  };
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
