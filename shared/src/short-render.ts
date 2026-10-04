/**
 * A video waiting for, or made by, the render queue (docs/short-video-plan.md
 * §6.6). One per video: Render now, Retry and each video of a schedule's batch
 * each queue one. The queue (worker/src/stream/render-queue.ts) works through
 * them per encoder, one at a time, and records the outcome here — a render is
 * never deleted by the queue, so recent renders stay listed with their reason.
 *
 * Pure contract + helpers; persistence is `db.shortRenders`.
 */
import type { YoutubePrivacy } from "./runs";
import type { ShortFormat } from "./short-format";
import { sanitizeInclude, sanitizeScope, type ShortInclude, type ShortScope } from "./short-script";

/** The YouTube video settings of a format (§5.2). */
export type ShortFormatVideo = ShortFormat["video"];

/** `auto` scope: pick the country or area with the most going on (§8, WP9a). */
export interface ShortAutoScope {
  type: "auto";
  of: "country" | "area";
}

export type ShortRenderStatus = "queued" | "preparing" | "live" | "done" | "skipped" | "failed" | "cancelled";

export interface ShortRender {
  id: string;
  /** A named encoder, or "any" for the first idle video encoder. */
  encoderId: string | "any";
  /** A saved script, or a request to generate one when this reaches the front.
   *  `auto` scope is resolved at the front too, like the rest of generate (§8). */
  what:
    | { type: "script"; scriptId: string }
    | {
        type: "generate";
        formatId: string;
        scope: ShortScope | ShortAutoScope;
        include?: ShortInclude;
      };
  publishAs: YoutubePrivacy;
  offline: boolean;
  /** The YouTube account; absent = the format's render default. */
  accountId?: string;
  /** This video's overrides of the format's YouTube settings: the Render form's
   *  title, or a schedule's `ScheduledVideo.video`. */
  video?: Partial<ShortFormatVideo>;
  /** How fresh the round-up must be (§8). Checked at the front of the queue. */
  roundup?: { maxAgeHours: number; ifStale: "refresh" | "skip" };
  /** Carried from the schedule; checked at the front with the rest. */
  skipIfQuiet?: boolean;
  scheduleId?: string;
  /** Set when a schedule queued several videos together. */
  batchId?: string;
  status: ShortRenderStatus;
  /** Give up if it hasn't started by then. */
  startBy?: number;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  scriptId?: string;
  runId?: string;
  videoUrl?: string;
  note?: string;
  /** The encoder that took it — differs from `encoderId` for an "any" render. */
  assignedEncoderId?: string;
  /** Set on a retry: the render this one repeats. */
  retryOf?: string;
  /** The format it renders in, stamped when queued (a script's format, or the
   *  generate request's). Drives "one video per format", the preview refusal
   *  (§5.3) and the format delete guard. */
  formatId?: string;
}

/** The format a render makes its video in, when known without loading a script. */
export const renderFormatId = (r: Pick<ShortRender, "formatId" | "what">): string | undefined =>
  r.formatId ?? (r.what.type === "generate" ? r.what.formatId : undefined);

/** Queue state for one encoder (§6.7 Pause / Resume). */
export interface ShortRenderQueueState {
  encoderId: string;
  paused: boolean;
}

/** The pool a render queued for any video encoder sits in. */
export const ANY_ENCODER = "any";

const PRIVACIES: readonly YoutubePrivacy[] = ["public", "unlisted", "private"];
const ACTIVE: readonly ShortRenderStatus[] = ["preparing", "live"];
const FINISHED: readonly ShortRenderStatus[] = ["done", "skipped", "failed", "cancelled"];

/** A render an encoder is working on (holds its encoder and its format). */
export const renderIsActive = (s: ShortRenderStatus): boolean => ACTIVE.includes(s);
/** A render with an outcome. */
export const renderIsFinished = (s: ShortRenderStatus): boolean => FINISHED.includes(s);
/** Retry is offered for these (§6.7). */
export const renderCanRetry = (s: ShortRenderStatus): boolean => s === "failed" || s === "skipped" || s === "cancelled";

/** What a caller (the Render form, a schedule) sends to queue a video. */
export type ShortRenderRequest = Omit<
  ShortRender,
  "id" | "status" | "queuedAt" | "startedAt" | "endedAt" | "scriptId" | "runId" | "videoUrl" | "note" | "assignedEncoderId" | "retryOf" | "formatId"
>;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function sanitizeVideo(v: unknown): Partial<ShortFormatVideo> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const s = v as Record<string, unknown>;
  const out: Partial<ShortFormatVideo> = {};
  if (typeof s.title === "string" && s.title.trim()) out.title = s.title.trim().slice(0, 500);
  if (typeof s.description === "string") out.description = s.description.slice(0, 10_000);
  if (typeof s.timezone === "string" && s.timezone.trim()) out.timezone = s.timezone.trim();
  const th = s.thumbnail as Record<string, unknown> | undefined;
  if (th && th.source === "image" && typeof th.url === "string") out.thumbnail = { source: "image", url: th.url.trim() };
  if (th && th.source === "frame" && typeof th.atMs === "number" && Number.isFinite(th.atMs)) {
    out.thumbnail = { source: "frame", atMs: Math.max(0, Math.round(th.atMs)) };
  }
  if (Array.isArray(s.tags)) out.tags = s.tags.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim());
  if (typeof s.categoryId === "string" && s.categoryId.trim()) out.categoryId = s.categoryId.trim();
  if (typeof s.playlistId === "string" && s.playlistId.trim()) out.playlistId = s.playlistId.trim();
  if (PRIVACIES.includes(s.publishAs as YoutubePrivacy)) out.publishAs = s.publishAs as YoutubePrivacy;
  if (typeof s.chapters === "boolean") out.chapters = s.chapters;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Validate an untrusted queue request (an API body). Returns null when it can't
 * be a render: no encoder, nothing to make. Privacy defaults to unlisted (§12).
 */
export function sanitizeRenderRequest(v: unknown): ShortRenderRequest | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const encoderId = str(s.encoderId) || ANY_ENCODER;
  const w = (s.what && typeof s.what === "object" ? s.what : {}) as Record<string, unknown>;
  let what: ShortRender["what"];
  if (w.type === "script" && str(w.scriptId)) {
    what = { type: "script", scriptId: str(w.scriptId) };
  } else if (w.type === "generate" && str(w.formatId)) {
    const sc = w.scope as Record<string, unknown> | undefined;
    const scope: ShortScope | ShortAutoScope | null =
      sc && sc.type === "auto" && (sc.of === "country" || sc.of === "area") ? { type: "auto", of: sc.of } : sanitizeScope(sc);
    if (!scope) return null;
    what = { type: "generate", formatId: str(w.formatId), scope };
    if (w.include !== undefined) what.include = sanitizeInclude(w.include);
  } else {
    return null;
  }
  const req: ShortRenderRequest = {
    encoderId,
    what,
    publishAs: PRIVACIES.includes(s.publishAs as YoutubePrivacy) ? (s.publishAs as YoutubePrivacy) : "unlisted",
    offline: s.offline === true,
  };
  if (str(s.accountId)) req.accountId = str(s.accountId);
  const video = sanitizeVideo(s.video);
  if (video) req.video = video;
  const r = s.roundup as Record<string, unknown> | undefined;
  if (r && typeof r.maxAgeHours === "number" && r.maxAgeHours > 0 && (r.ifStale === "refresh" || r.ifStale === "skip")) {
    req.roundup = { maxAgeHours: r.maxAgeHours, ifStale: r.ifStale };
  }
  if (s.skipIfQuiet === true) req.skipIfQuiet = true;
  if (str(s.scheduleId)) req.scheduleId = str(s.scheduleId);
  if (str(s.batchId)) req.batchId = str(s.batchId);
  if (typeof s.startBy === "number" && Number.isFinite(s.startBy)) req.startBy = s.startBy;
  return req;
}
