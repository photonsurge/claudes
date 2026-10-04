/**
 * Client helpers + types for video RENDERS (docs/short-video-plan.md §6.1,
 * §6.6-6.7): the Render form, the Renders section on /admin/shorts and the
 * encoder picker. The API (`/api/shorts/renders/**`) reads `db.shortRenders`
 * and hands every change (queue, pause, resume, cancel, retry, stop) to the
 * worker's render queue, which owns the state.
 *
 * Pure helpers (queue positions, the status line, the encoder ordering) are
 * exported for the components and their tests.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EncoderOccupancy } from "@photonsurge/shared/encoder-occupancy";
import {
  ANY_ENCODER,
  renderIsFinished,
  renderIsWaiting,
  type ShortRender,
  type ShortRenderRequest,
} from "@photonsurge/shared/short-render";
import { encoderUse, type EncoderUse, type RunState, type StreamEncoderInfo } from "@photonsurge/shared/runs";
import { formatDuration } from "./shorts";

/** An encoder as the /api/streams snapshot returns it: with what it is doing (§6.2). */
export type EncoderWithOccupancy = StreamEncoderInfo & { occupancy?: EncoderOccupancy };

/** The play a live render is making — enough for "clip 2 of 3, 0:45 left". */
export interface RenderPlay {
  startedAt: number;
  endedAt?: number;
  clips: { startMs: number; durationMs: number }[];
}

/** One row of the Renders list. */
export interface RenderRow extends ShortRender {
  /** The script's working title (or the generate request's scope) — what the row is called before a run exists. */
  label?: string;
  /** The run it made, secret-free (status, title, watch URL…). */
  run?: RunState | null;
  /** The script's play on the run's scene, while it plays or once it has. */
  play?: RenderPlay | null;
}

/** One queue header: a video encoder (or a channel encoder with videos named for it), or the "any" pool. */
export interface RenderQueueRow {
  /** An encoder id, or "any". */
  encoderId: string;
  name?: string;
  use?: EncoderUse;
  paused: boolean;
}

export interface RendersResponse {
  /** Newest first: every unfinished render and the recent finished ones. */
  renders: RenderRow[];
  queues: RenderQueueRow[];
}

type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(url: string, init?: RequestInit): Promise<Outcome<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok === false) return { ok: false, error: body?.error || `HTTP ${res.status}` };
    return { ok: true, data: body as T };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const listRenders = () => call<RendersResponse>("/api/shorts/renders");
/** Queue a video. Resolves with the stored render (it may already be preparing). */
export const queueRender = (req: ShortRenderRequest) =>
  call<{ ok: true; render: ShortRender }>("/api/shorts/renders", jsonPost(req));

export type RenderAction =
  | { action: "pause" | "resume"; encoderId: string }
  | { action: "cancel" | "retry" | "stop"; renderId: string };
/** Pause / Resume an encoder's queue; Cancel, Retry or Stop a video (§6.7). */
export const controlRender = (a: RenderAction) =>
  call<{ ok: true; render?: ShortRender }>("/api/shorts/renders/control", jsonPost(a));

// ---- pure helpers ----

/** The queue a render waits in: its named encoder, or the "any" pool. */
export const renderQueueKey = (r: Pick<ShortRender, "encoderId">): string => r.encoderId || ANY_ENCODER;

/**
 * 1-based place in line for every queued render, per queue, oldest first. A
 * video queued for later (`notBefore`) has no place until its time comes — it
 * doesn't hold up the videos behind it.
 */
export function queuePositions(
  renders: Pick<ShortRender, "id" | "encoderId" | "status" | "queuedAt" | "notBefore">[],
  now: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const byQueue = new Map<string, typeof renders>();
  for (const r of renders) {
    if (r.status !== "queued" || renderIsWaiting(r, now)) continue;
    const k = renderQueueKey(r);
    byQueue.set(k, [...(byQueue.get(k) ?? []), r]);
  }
  for (const list of byQueue.values()) {
    [...list].sort((a, b) => a.queuedAt - b.queuedAt).forEach((r, i) => out.set(r.id, i + 1));
  }
  return out;
}

/** Where a play stands at `now`: the clip it is on (1-based), of how many, and the time left. */
export function playProgress(play: RenderPlay, now: number): { clip: number; of: number; leftMs: number } | null {
  if (!play.clips.length) return null;
  const at = now - play.startedAt;
  const total = Math.max(...play.clips.map((c) => c.startMs + c.durationMs));
  let clip = 1;
  play.clips.forEach((c, i) => {
    if (at >= c.startMs) clip = i + 1;
  });
  return { clip, of: play.clips.length, leftMs: Math.max(0, total - at) };
}

export type RenderBadgeColor = "default" | "info" | "warning" | "error" | "success";

/** The status badge (§6.7) and the line beside it. */
export interface RenderStatus {
  label: string;
  color: RenderBadgeColor;
  /** The outcome's reason, the clip progress, the start time… */
  detail?: string;
}

const clock = (ms: number) => new Date(ms).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

/**
 * The status a Renders row shows (§6.7): queued (with its place), waiting for
 * its time, preparing, awaiting ingest, live with clip N of M and time left,
 * done, skipped, failed (with the reason), cancelled. The run (from the socket
 * when it is fresher) decides "awaiting ingest" vs "live".
 */
export function renderStatus(
  r: RenderRow,
  now: number,
  position?: number,
  run: RunState | null | undefined = r.run,
): RenderStatus {
  switch (r.status) {
    case "queued":
      if (renderIsWaiting(r, now))
        return { label: "queued", color: "default", detail: `starts at ${clock(r.notBefore!)}` };
      return { label: position ? `queued · #${position}` : "queued", color: "default" };
    case "preparing":
    case "live": {
      if (run?.status === "awaiting-ingest") return { label: "awaiting ingest", color: "warning" };
      if (r.status === "preparing" || !run || run.status === "scheduled") return { label: "preparing", color: "info" };
      if (run.status === "ending") return { label: "ending", color: "warning" };
      const p = r.play && r.play.endedAt == null ? playProgress(r.play, now) : null;
      return {
        label: r.offline ? "rehearsing" : "live",
        color: "error",
        detail: p ? `clip ${p.clip} of ${p.of} · ${formatDuration(p.leftMs)} left` : "starting the script",
      };
    }
    case "done":
      return { label: "done", color: "success", detail: r.offline ? "offline test" : undefined };
    case "skipped":
      return { label: "skipped", color: "warning", detail: r.note };
    case "failed":
      return { label: "failed", color: "error", detail: r.note };
    case "cancelled":
      return { label: "cancelled", color: "default", detail: r.note };
  }
}

/**
 * The encoders a video can be queued on, in the order the Render form lists
 * them (§6.1, §6.6): video encoders first, then channel encoders.
 */
export function encodersForVideo<E extends Pick<StreamEncoderInfo, "id" | "use">>(encoders: E[]): E[] {
  return [...encoders.filter((e) => encoderUse(e) === "videos"), ...encoders.filter((e) => encoderUse(e) !== "videos")];
}

/** The encoders a CHANNEL may use: never one assigned to videos (§6.6). A saved
 *  pick that has since become a video encoder is kept so it still shows. */
export function encodersForChannel<E extends Pick<StreamEncoderInfo, "id" | "use">>(encoders: E[], keep?: string): E[] {
  return encoders.filter((e) => encoderUse(e) !== "videos" || e.id === keep);
}

/** The encoder the Render form starts on: the format's default when it can take a
 *  video, else the first video encoder that can, else "any". */
export function defaultRenderEncoder(encoders: EncoderWithOccupancy[], formatDefault?: string): string {
  const can = (e?: EncoderWithOccupancy) => !!e && e.enabled && e.occupancy?.canQueueVideo !== false;
  const fmt = encoders.find((e) => e.id === formatDefault);
  if (formatDefault && can(fmt)) return formatDefault;
  const first = encodersForVideo(encoders).find((e) => encoderUse(e) === "videos" && can(e));
  return first?.id ?? ANY_ENCODER;
}

/** True while anything in the list can still change on its own. */
export const rendersActive = (data: RendersResponse | null): boolean =>
  !!data?.renders.some((r) => !renderIsFinished(r.status));

/** Poll periods: quick while a video is queued or rendering, slow otherwise. */
export const RENDERS_POLL_ACTIVE_MS = 3_000;
export const RENDERS_POLL_IDLE_MS = 30_000;

/**
 * The Renders list, polled (quickly while anything is unfinished). `bump` asks
 * for a refresh now (a socket run event, an action). Identity is stable: an
 * unchanged payload doesn't replace `data`.
 */
export function useRenders(load: typeof listRenders = listRenders): {
  data: RendersResponse | null;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<RendersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fingerprint = useRef("");

  const refresh = useCallback(async () => {
    const res = await load();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    const next = JSON.stringify(res.data);
    if (next === fingerprint.current) return;
    fingerprint.current = next;
    setData(res.data);
  }, [load]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const active = rendersActive(data);
  useEffect(() => {
    const t = setInterval(refresh, active ? RENDERS_POLL_ACTIVE_MS : RENDERS_POLL_IDLE_MS);
    return () => clearInterval(t);
  }, [active, refresh]);

  return { data, error, refresh };
}
