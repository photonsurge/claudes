/**
 * Client helpers for short video FORMATS (docs/short-video-plan.md §5): the
 * Formats section on /admin/shorts and the format editor at
 * /admin/shorts/formats/:id.
 *
 * A format is two things keyed by one id: its own hidden scene (look + director
 * config, saved through the scene and director APIs) and its short settings
 * (`ShortFormat`, saved through /api/shorts/formats/:id). The editor's draft
 * (components/admin/scenes/SceneDraft.tsx) holds all three documents and saves
 * them with one Save.
 *
 * Pure helpers (the PUT body, the title / description preview, the example
 * values) are exported for the cards and their tests.
 */
import type { ShortFormat } from "@photonsurge/shared/short-format";
import {
  VIDEO_TEXT_TIMEZONE,
  VIDEO_TEXT_TOKENS,
  clipYouTubeDescription,
  formatVideoText,
  isValidTimeZone,
  trimVideoTitle,
  type VideoTextValues,
} from "@photonsurge/shared/video-text";
import type { StreamEncoderInfo } from "@photonsurge/shared/runs";
import type { SceneMeta } from "@photonsurge/shared/control";
import { listScenes } from "./scenes";
import type { StreamAccount } from "./stream";
import type { ShortFormatItem } from "./shorts";

type Outcome<T> = { ok: true; data: T } | { ok: false; error: string; status?: number; body?: Record<string, unknown> };

async function call<T>(url: string, init?: RequestInit): Promise<Outcome<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}`, status: res.status, body };
    return { ok: true, data: body as T };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const formatUrl = (id: string) => `/api/shorts/formats/${encodeURIComponent(id)}`;

export const listFormats = () => call<{ formats: ShortFormatItem[]; defaultId: string }>("/api/shorts/formats");
export const getShortFormat = (id: string) => call<ShortFormat>(formatUrl(id));
/** Make a format by duplicating a channel (its scene id) or another format (its id). */
export const createShortFormat = (name: string, from: string) =>
  call<{ format: ShortFormat }>("/api/shorts/formats", json("POST", { name, from }));
/** Refused for the default format, and while scripts use it — the error says how many. */
export const deleteShortFormat = (id: string) => call<{ ok: true }>(formatUrl(id), { method: "DELETE" });
/** "Copy look from…": re-copy a channel's or format's look onto this format's scene. */
export const copyFormatLook = (id: string, from: string) =>
  call<{ format: ShortFormat }>(`${formatUrl(id)}/copy-look`, json("POST", { from }));

/** What a format can be duplicated or copy its look from: every channel and
 *  every format. A failed list comes back empty rather than failing the form. */
export async function loadFormatSources(): Promise<{ channels: SceneMeta[]; formats: ShortFormatItem[] }> {
  const [channels, formats] = await Promise.all([listScenes({ kind: "channel" }), listFormats()]);
  return { channels, formats: formats.ok ? formats.data.formats : [] };
}

/** A patch of the short settings, as the editor's draft stages it: whole
 *  top-level fields, so the patch merges by a plain spread. */
export type ShortFormatPatch = Partial<Omit<ShortFormat, "id">>;

/**
 * The PUT body for a staged patch. The server sanitises the body ONTO the
 * stored format, where an ABSENT key keeps the stored value — so a value the
 * operator cleared must be sent as an explicit clear: a template with no scope
 * sends `scope: null`, a render default left empty sends "", and so does an
 * empty playlist.
 */
export function formatPatchBody(patch: ShortFormatPatch): Record<string, unknown> {
  const body: Record<string, unknown> = { ...patch };
  if (patch.template) body.template = { ...patch.template, scope: patch.template.scope ?? null };
  if (patch.render) body.render = { encoderId: patch.render.encoderId ?? "", accountId: patch.render.accountId ?? "" };
  if (patch.video) body.video = { ...patch.video, playlistId: patch.video.playlistId ?? "" };
  return body;
}

/** Save a staged patch of the short settings; resolves with the saved format. */
export async function saveShortFormat(id: string, patch: ShortFormatPatch): Promise<ShortFormat> {
  const res = await call<ShortFormat>(formatUrl(id), json("PUT", formatPatchBody(patch)));
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** The encoders and connected YouTube channels the render defaults pick from
 *  (the same lists the streams page's run form offers). Empty on failure. */
export async function fetchRenderOptions(): Promise<{ encoders: StreamEncoderInfo[]; accounts: StreamAccount[] }> {
  const res = await call<{ encoders?: StreamEncoderInfo[]; accounts?: StreamAccount[] }>("/api/streams");
  if (!res.ok) return { encoders: [], accounts: [] };
  return { encoders: res.data.encoders ?? [], accounts: res.data.accounts ?? [] };
}

/** Every `%{name}` code's example value — what the preview uses when the format
 *  has no script yet, or its script carries no values. */
export function exampleVideoValues(): VideoTextValues {
  return Object.fromEntries(VIDEO_TEXT_TOKENS.map(([code, , example]) => [code.slice(2, -1), example]));
}

/** The zone a preview resolves date codes in. "place" has no single zone
 *  before render (and a several-places video uses London anyway), so the
 *  preview shows London time for it; an unknown zone also falls back. */
export function previewTimeZone(timezone: string): string {
  return timezone !== "place" && isValidTimeZone(timezone) ? timezone : VIDEO_TEXT_TIMEZONE;
}

/** The YouTube title a template gives: resolved, then trimmed to 100 characters. */
export function previewVideoTitle(template: string, values: VideoTextValues, now: Date, timezone: string): string {
  return trimVideoTitle(formatVideoText(template, values, now, previewTimeZone(timezone)));
}

/** The YouTube description a template gives: resolved, then clipped as live descriptions are. */
export function previewVideoDescription(template: string, values: VideoTextValues, now: Date, timezone: string): string {
  return clipYouTubeDescription(formatVideoText(template, values, now, previewTimeZone(timezone)));
}

/** Length in code points — what `trimVideoTitle` counts, so an emoji is never split. */
export const textLength = (s: string): number => Array.from(s).length;

/**
 * Common YouTube video categories (ids are YouTube's own, region US/GB). Not
 * the whole list — a format with another id keeps it and the picker shows it.
 */
export const YOUTUBE_CATEGORIES: readonly { id: string; label: string }[] = [
  { id: "1", label: "Film & Animation" },
  { id: "2", label: "Autos & Vehicles" },
  { id: "10", label: "Music" },
  { id: "15", label: "Pets & Animals" },
  { id: "17", label: "Sports" },
  { id: "19", label: "Travel & Events" },
  { id: "20", label: "Gaming" },
  { id: "22", label: "People & Blogs" },
  { id: "23", label: "Comedy" },
  { id: "24", label: "Entertainment" },
  { id: "25", label: "News & Politics" },
  { id: "26", label: "Howto & Style" },
  { id: "27", label: "Education" },
  { id: "28", label: "Science & Technology" },
  { id: "29", label: "Nonprofits & Activism" },
];
