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

/** Socket event: worker → every browser. The current on-air segment + queue. */
export const DIRECTOR_STATE = "director:state" as const;

/** What kind of thing a segment is showing — also the OBS-scene key (phase 2). */
export type SegmentKind =
  | "intro" // global establishing spin
  | "tour" // curated region flyover (ambient filler when nothing notable)
  | "weather" // scalar field over a region of interest
  | "storm" // a severe-weather alert area
  | "quake" // a recent significant earthquake
  | "flight" // a notable aircraft
  | "ship"; // a notable vessel

export const SEGMENT_KINDS: SegmentKind[] = [
  "intro",
  "tour",
  "weather",
  "storm",
  "quake",
  "flight",
  "ship",
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
  /** Smaller context line, e.g. "Gulf of Mexico · Hurricane Warning". */
  subtitle?: string;
  camera: DirectorCamera;
  /** ControlState fields to assert while this segment is on air. */
  patch: Partial<ControlState>;
  /** How long to hold this shot, in ms. */
  holdMs: number;
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
  /** Which kinds are eligible to be scheduled. */
  kinds: Record<SegmentKind, boolean>;
  /** Only schedule quakes at/above this magnitude. */
  minQuakeMag: number;
  /** Only schedule storms at/above this normalised severity (0–4). */
  minAlertSeverity: number;
  /**
   * Bump to force-cut the current segment immediately. The worker remembers the
   * last value it acted on; any increase skips. (Monotonic, operator-driven.)
   */
  skipNonce: number;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  mode: "off",
  holdSeconds: 12,
  kinds: {
    intro: true,
    tour: true,
    weather: true,
    storm: true,
    quake: true,
    flight: true,
    ship: true,
  },
  minQuakeMag: 4.5,
  minAlertSeverity: 3,
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
    kinds,
    minQuakeMag: num(patch.minQuakeMag, base.minQuakeMag),
    minAlertSeverity: num(patch.minAlertSeverity, base.minAlertSeverity),
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
