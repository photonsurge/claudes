/**
 * Director commands — the ONE way anything outside the director changes what
 * it airs. Operator requests (Take, Go to, Hold, Pause, Skip) and, under a
 * channel's chat policy, viewer requests both land as rows in one per-scene
 * queue (`director_commands`); the worker loop drains it every tick and stays
 * the single writer of on-air state.
 *
 * Precedence: operator > break-in > viewer > rotation. `pause` freezes all of
 * it, break-ins included. A command leaves the queue only by being applied,
 * refused with a reason, expiring, or an explicit clear — every outcome is a
 * row someone can read later.
 *
 * See docs/done/director-programme-plan.md §3.6 and §4.4.
 */
import type { SegmentKind } from "./director";
import type { StreamPlatform } from "./runs";

export type CommandSource =
  | { kind: "operator"; user: string }
  | { kind: "viewer"; platform: StreamPlatform | "sim"; author: string; isMod?: boolean }
  | { kind: "system"; job: string };

/** What to point the camera at. Resolved to a Segment in the worker. */
export type CommandTarget =
  | { type: "segment"; id: string }
  | { type: "kind"; kind: SegmentKind }
  | { type: "place"; query: string }
  | { type: "roundup"; place?: string }
  | { type: "mapType"; id: string };

export type DirectorOp =
  /** Go there now. */
  | { op: "cut"; target: CommandTarget; holdS?: number }
  /** Go there at the next shot change. */
  | { op: "queue"; target: CommandTarget; holdS?: number }
  | { op: "skip" }
  | { op: "hold"; extendS: number }
  | { op: "pause"; untilMs?: number }
  | { op: "resume" }
  | { op: "clear" };

export type CommandStatus = "queued" | "applied" | "refused" | "expired" | "dropped";

export interface DirectorCommand {
  id: string;
  sceneId: string;
  source: CommandSource;
  cmd: DirectorOp;
  status: CommandStatus;
  /** Human-readable outcome: "cut at seq 41", "no quake in the pool", "director is off". */
  note?: string;
  /** The segment it resolved to, once applied. */
  resolved?: { id: string; title: string };
  createdAt: number;
  /** A queued command lapses on its own — a request from an hour ago must not fire later. */
  expiresAt: number;
  appliedAt?: number;
  appliedSeq?: number;
  /** A viewer's request carries the channel's policy as it stood when asked,
   *  so the loop can pace it without reading the scene: the minimum gap
   *  between viewer cuts, whether it may air mid-shot, and whether a place may
   *  resolve to a city. */
  viewer?: { everyS: number; immediate: boolean; allowCities: boolean };
}

/** How long a command waits before it lapses. */
export const OPERATOR_COMMAND_TTL_MS = 10 * 60_000;
/** Bounds on a requested hold, seconds. */
export const COMMAND_HOLD_MIN_S = 3;
export const COMMAND_HOLD_MAX_S = 3600;
export const COMMAND_HOLD_EXTEND_MAX_S = 600;

const SEGMENT_KIND_IDS = new Set<string>([
  "intro", "global", "ocean", "orbital", "country", "region", "point", "storm", "volcano", "quake", "flight", "ship", "ad",
]);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

function validTarget(raw: unknown): CommandTarget | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case "segment":
      return str(raw.id) && raw.id.includes(":") ? { type: "segment", id: raw.id } : null;
    case "kind":
      return typeof raw.kind === "string" && SEGMENT_KIND_IDS.has(raw.kind) && raw.kind !== "point" && raw.kind !== "ad"
        ? { type: "kind", kind: raw.kind as SegmentKind }
        : null;
    case "place":
      return str(raw.query, 80) ? { type: "place", query: raw.query.trim() } : null;
    case "roundup":
      if (raw.place === undefined) return { type: "roundup" };
      return str(raw.place, 80) ? { type: "roundup", place: raw.place.trim() } : null;
    case "mapType":
      return str(raw.id, 40) ? { type: "mapType", id: raw.id } : null;
    default:
      return null;
  }
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Validate an untrusted op (the admin route's body). Returns the op with holds
 * clamped, or null when the shape is wrong.
 */
export function validateOp(raw: unknown): DirectorOp | null {
  if (!isObj(raw)) return null;
  const hold = (v: unknown) =>
    v === undefined ? undefined : finite(v) ? Math.min(COMMAND_HOLD_MAX_S, Math.max(COMMAND_HOLD_MIN_S, v)) : null;
  switch (raw.op) {
    case "cut":
    case "queue": {
      const target = validTarget(raw.target);
      const holdS = hold(raw.holdS);
      if (!target || holdS === null) return null;
      return holdS === undefined ? { op: raw.op, target } : { op: raw.op, target, holdS };
    }
    case "skip":
    case "resume":
    case "clear":
      return { op: raw.op };
    case "hold":
      return finite(raw.extendS) && raw.extendS > 0
        ? { op: "hold", extendS: Math.min(COMMAND_HOLD_EXTEND_MAX_S, raw.extendS) }
        : null;
    case "pause":
      if (raw.untilMs === undefined) return { op: "pause" };
      return finite(raw.untilMs) ? { op: "pause", untilMs: raw.untilMs } : null;
    default:
      return null;
  }
}

/** The ops that change the director's state rather than what it points at. */
export type ControlOp = Extract<DirectorOp, { op: "skip" | "hold" | "pause" | "resume" | "clear" }>;
export const isControlOp = (op: DirectorOp): op is ControlOp => op.op !== "cut" && op.op !== "queue";

export interface ArbitrationView {
  now: number;
  /** The current shot has expired or a skip is due this tick. */
  atBoundary: boolean;
}

export interface Arbitration {
  /** Past `expiresAt` — settle as expired. */
  expired: DirectorCommand[];
  /** Skip / hold / pause / resume / clear, oldest first — apply all, now. */
  control: DirectorCommand[];
  /** An operator `cut` to put on air now (the oldest; any others wait a tick). */
  cutNow: DirectorCommand | null;
  /** The operator's oldest `queue` command, whose turn it is at this shot boundary. */
  atBoundary: DirectorCommand | null;
  /** The oldest viewer request (`cut` or `queue`). The loop decides when it may
   *  air — behind the operator and breaking news, and the channel's pacing. */
  viewerNext: DirectorCommand | null;
}

/**
 * Pure: which pending commands act this tick. `pending` must be oldest-first.
 * Everything not returned stays queued and is looked at again next tick.
 */
export function arbitrate(pending: readonly DirectorCommand[], view: ArbitrationView): Arbitration {
  const out: Arbitration = { expired: [], control: [], cutNow: null, atBoundary: null, viewerNext: null };
  for (const c of pending) {
    if (c.status !== "queued") continue;
    if (view.now >= c.expiresAt) {
      out.expired.push(c);
      continue;
    }
    if (isControlOp(c.cmd)) {
      out.control.push(c);
    } else if (c.source.kind !== "operator") {
      out.viewerNext ??= c;
    } else if (c.cmd.op === "cut") {
      out.cutNow ??= c;
    } else if (view.atBoundary) {
      out.atBoundary ??= c;
    }
  }
  return out;
}

/** A short label for the queue readout and the command log. */
export function describeOp(op: DirectorOp): string {
  const target = (t: CommandTarget) => {
    switch (t.type) {
      case "segment":
        return t.id;
      case "kind":
        return `a ${t.kind}`;
      case "place":
        return t.query;
      case "roundup":
        return t.place ? `${t.place} round-up` : "world round-up";
      case "mapType":
        return `${t.id} map`;
    }
  };
  switch (op.op) {
    case "cut":
      return `Take ${target(op.target)}`;
    case "queue":
      return `Next: ${target(op.target)}`;
    case "skip":
      return "Skip";
    case "hold":
      return `Hold +${op.extendS}s`;
    case "pause":
      return "Pause";
    case "resume":
      return "Resume";
    case "clear":
      return "Clear queue";
  }
}
