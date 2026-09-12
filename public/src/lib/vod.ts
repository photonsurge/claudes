/**
 * Client side of the VOD as-run pages (/admin/streams/:id) — the bundle shape
 * served by GET /api/streams/:id/asrun and its fetch. Offsets arrive computed;
 * the page only formats (shared/vod's fmtOffset) and seeks.
 */
import type { RunState } from "@photonsurge/shared/runs";
import type { AsRunItem, VideoTimeBase } from "@photonsurge/shared/vod";
import type { AirEntry } from "./airlog";

export interface AsRunVideo {
  /** YouTube video id (= the broadcast id); null for a run with no YouTube binding. */
  id: string | null;
  watchUrl: string | null;
  actualStartTime: number | null;
  actualEndTime: number | null;
  /** Null when the run never went live. */
  base: VideoTimeBase | null;
  leadMs: number;
}

export interface AsRunBundle {
  run: RunState;
  sceneName: string;
  video: AsRunVideo;
  /** Our-clock span of the video; `toMs` null while live; null when never live. */
  window: { fromMs: number; toMs: number | null } | null;
  /** Director sessions (AirRun ids) the video drew from, in air order. */
  sessions: string[];
  kindCounts: Record<string, number>;
  items: AsRunItem<AirEntry>[];
}

/** The public per-video bundle from GET /api/vod/:videoId — secret-free, no run internals. */
export interface PublicVodBundle {
  title: string | null;
  sceneName: string;
  status: string;
  startAt: number | null;
  endedAt: number | null;
  video: { id: string; watchUrl: string | null };
  window: { fromMs: number; toMs: number | null } | null;
  kindCounts: Record<string, number>;
  items: AsRunItem<AirEntry>[];
}

export async function getPublicVod(videoId: string): Promise<PublicVodBundle | null> {
  const res = await fetch(`/api/vod/${encodeURIComponent(videoId)}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export async function getAsRun(runId: string): Promise<AsRunBundle | null> {
  const res = await fetch(`/api/streams/${encodeURIComponent(runId)}/asrun`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export interface ChaptersResult {
  ok: boolean;
  skipped?: string;
  count?: number;
  changed?: boolean;
  descriptionLength?: number;
  error?: string;
}

/** (Re)publish the run's as-run chapters into its YouTube description, now. Never throws. */
export async function publishChapters(runId: string): Promise<ChaptersResult> {
  try {
    const res = await fetch(`/api/streams/${encodeURIComponent(runId)}/chapters`, { method: "POST", cache: "no-store" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return (await res.json()) as ChaptersResult;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

export interface ThumbnailResult {
  ok: boolean;
  skipped?: string;
  source?: string;
  bytes?: number;
  error?: string;
}

/** POST /api/streams/:id/thumbnail — (re)upload the run's thumbnail now; never throws. */
export async function publishThumbnail(runId: string): Promise<ThumbnailResult> {
  try {
    const res = await fetch(`/api/streams/${encodeURIComponent(runId)}/thumbnail`, { method: "POST", cache: "no-store" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return (await res.json()) as ThumbnailResult;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** How much of the video the director log accounts for — cuts vs. unlogged stretches. */
export function asRunCoverage(items: AsRunItem<unknown>[], nowOffsetMs?: number): { cuts: number; loggedMs: number; gapMs: number } {
  let cuts = 0;
  let loggedMs = 0;
  let gapMs = 0;
  for (const it of items) {
    const end = it.endOffsetMs ?? nowOffsetMs ?? it.offsetMs;
    const span = Math.max(0, end - it.offsetMs);
    if (it.type === "cut") {
      cuts += 1;
      loggedMs += span;
    } else {
      gapMs += span;
    }
  }
  return { cuts, loggedMs, gapMs };
}
