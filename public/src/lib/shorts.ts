/**
 * Client helpers + types for scripted short videos (docs/short-video-plan.md) —
 * the /admin/shorts page. The API (`/api/shorts/**`) only reads and writes
 * Mongo; generating a script runs the worker's `short-video.generate` job, and
 * a preview play is a director-config write the worker's script runner picks up.
 *
 * Every script plays on its FORMAT's own scene (§5.3) — preview and render
 * alike — so the page shows each format's scene state and previews a script on
 * its format's scene.
 *
 * Pure helpers (labels, durations, the preview play state) are exported for
 * the components and their tests.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DirectorMode } from "@photonsurge/shared/director";
import { COUNTRY_SHOTS } from "@photonsurge/shared/director-countries";
import { REGION_SHOTS } from "@photonsurge/shared/director-regions";
import type { ShortInclude, ShortScope, ShortScript, ShortScriptPlay } from "@photonsurge/shared/short-script";
import type { ShortFormat } from "@photonsurge/shared/short-format";
import { DEFAULT_SHORT_FORMAT_ID } from "@photonsurge/shared/short-scenes";

/** One row of the scripts table — a light projection of a ShortScript. */
export interface ShortListItem {
  id: string;
  /** The format it's made in — and so the scene it previews on. */
  formatId: string;
  title: string;
  scope: ShortScope;
  status: ShortScript["status"];
  clipCount: number;
  durationMs: number;
  /** ISO creation time (the doc's `created` timestamp), when known. */
  created?: string;
  /** The latest play on its format's scene, without its per-clip schedule. */
  previewPlay?: Omit<ShortScriptPlay, "clips">;
}

/** A format's scene as the page needs it: does it exist, its watch token, and
 *  what its director is doing. */
export interface ShortPreviewInfo {
  sceneId: string;
  exists: boolean;
  /** Admin-only secret for the scene's /watch URL. */
  watchToken?: string;
  mode: DirectorMode;
  /** The script the director config points at (meaningful while `mode` is "script"). */
  scriptId?: string;
  playNonce?: number;
}

/** One format on the /admin/shorts snapshot: its name and its scene's state. */
export interface ShortFormatRow {
  id: string;
  name: string;
  preview: ShortPreviewInfo;
}

export interface ShortsListResponse {
  scripts: ShortListItem[];
  /** Every format, the default first — always present, seeded or not. */
  formats: ShortFormatRow[];
}

/** A format from /api/shorts/formats, with how many scripts are made in it. */
export type ShortFormatItem = ShortFormat & { scriptCount: number };

export interface GenerateShortRequest {
  /** Absent = the default format. */
  formatId?: string;
  scope: ShortScope;
  include?: Partial<ShortInclude>;
  budgetMs?: number;
  title?: string;
}

/** What the generate job returns. */
export interface GenerateShortResult {
  id: string;
  title: string;
  clips: number;
  durationMs: number;
}

type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(url: string, init?: RequestInit): Promise<Outcome<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}` };
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

export const listShorts = () => call<ShortsListResponse>("/api/shorts");
export const getShort = (id: string) => call<ShortScript>(`/api/shorts/${encodeURIComponent(id)}`);
/** Runs the worker job and waits for it — resolves with the worker's own error
 *  message on failure (it says what to fix). */
export const generateShort = (req: GenerateShortRequest) => call<GenerateShortResult>("/api/shorts/generate", jsonPost(req));
export const deleteShort = (id: string) =>
  call<{ ok: true }>(`/api/shorts/${encodeURIComponent(id)}`, { method: "DELETE" });
/** Preview a script on its format's scene. */
export const playShortPreview = (id: string, fromClip = 0) =>
  call<{ ok: true; playNonce: number; sceneId: string }>(`/api/shorts/${encodeURIComponent(id)}/play`, jsonPost({ fromClip }));
/** Stop whatever a format's scene is playing. */
export const stopShortPreview = (formatId: string = DEFAULT_SHORT_FORMAT_ID) =>
  call<{ ok: true }>("/api/shorts/stop", jsonPost({ formatId }));
export const listShortFormats = () => call<{ formats: ShortFormatItem[] }>("/api/shorts/formats");

/**
 * The preview state of `formatId`'s scene — a script's preview pane and play
 * state read it. Falls back to the default format's row (always listed), then
 * to a missing-scene stub, so a format that vanished never breaks the page.
 */
export function previewForFormat(data: Pick<ShortsListResponse, "formats"> | null, formatId?: string): ShortPreviewInfo {
  const formats = data?.formats ?? [];
  const id = formatId || DEFAULT_SHORT_FORMAT_ID;
  const row = formats.find((f) => f.id === id) ?? formats.find((f) => f.id === DEFAULT_SHORT_FORMAT_ID);
  return row?.preview ?? { sceneId: id, exists: false, mode: "off" };
}

/** m:ss (h:mm:ss past an hour) for a duration in ms. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const countryById = new Map(COUNTRY_SHOTS.map((c) => [c.id, c]));
const regionById = new Map(REGION_SHOTS.map((r) => [r.id, r]));

/** "Globe" / "Area · Northern Europe" / "Country · 🇯🇵 Japan" (raw id when the
 *  catalog no longer knows it). */
export function scopeLabel(scope: ShortScope): string {
  if (scope.type === "globe") return "Globe";
  if (scope.type === "area") return `Area · ${regionById.get(scope.id)?.name ?? scope.id}`;
  const c = countryById.get(scope.id);
  return `Country · ${c ? `${c.flag} ${c.name}` : scope.id}`;
}

/** The scope pickers' options — every catalog entry, sorted by name. */
export const COUNTRY_OPTIONS = [...COUNTRY_SHOTS]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((c) => ({ id: c.id, label: `${c.flag} ${c.name}` }));
export const AREA_OPTIONS = [...REGION_SHOTS]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((r) => ({ id: r.id, label: r.name }));

export type PreviewPlayState = "never" | "starting" | "playing" | "ended" | "stopped";

/**
 * Where a script stands on its format's scene (`preview`). "starting" covers the gap between
 * the play request (the director config names this script with a nonce) and
 * the runner stamping that nonce — a long "starting" means no worker picked it up.
 */
export function previewPlayState(item: Pick<ShortListItem, "id" | "previewPlay">, preview: ShortPreviewInfo): PreviewPlayState {
  const play = item.previewPlay;
  const requested = preview.mode === "script" && preview.scriptId === item.id;
  if (requested && (!play || play.playNonce !== preview.playNonce)) return "starting";
  if (!play) return "never";
  if (play.endedAt == null) return requested ? "playing" : "stopped";
  return play.stopped ? "stopped" : "ended";
}

/** True while anything on a format's scene can still change on its own. */
export function previewActive(data: ShortsListResponse | null): boolean {
  if (!data) return false;
  if (data.formats.some((f) => f.preview.mode === "script")) return true;
  return data.scripts.some((s) => s.previewPlay && s.previewPlay.endedAt == null);
}

/** Poll period while a preview play is in progress. */
export const SHORTS_POLL_MS = 2_000;

/**
 * The scripts list + each format scene's state. Loads once, then polls while a play
 * is in progress (`previewActive`). Identity stays stable: a poll that returns
 * the same payload doesn't replace `data`, and `refresh` never changes, so
 * consumers only re-render on a real change.
 */
export function useShortsList(): {
  data: ShortsListResponse | null;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<ShortsListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fingerprint = useRef<string>("");

  const refresh = useCallback(async () => {
    const res = await listShorts();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    const next = JSON.stringify(res.data);
    if (next === fingerprint.current) return;
    fingerprint.current = next;
    setData(res.data);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const active = previewActive(data);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(refresh, SHORTS_POLL_MS);
    return () => clearInterval(t);
  }, [active, refresh]);

  return { data, error, refresh };
}

/** A format scene's tokened /watch URL (relative — same origin as admin). */
export function previewWatchUrl(preview: Pick<ShortPreviewInfo, "sceneId" | "watchToken">): string {
  const base = `/watch/${encodeURIComponent(preview.sceneId)}`;
  return preview.watchToken ? `${base}?token=${encodeURIComponent(preview.watchToken)}` : base;
}
