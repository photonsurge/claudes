/**
 * YouTube broadcast description + thumbnail source — shared by the worker (which
 * resolves them at go-live) and the operator UIs (which preview and validate
 * them). Pure: no I/O.
 *
 * The description is a TEMPLATE with the same date codes as the title
 * (see ./stream-title); it is resolved once when the broadcast is created, and
 * the as-run chapters block is appended below it after the run ends (./vod
 * composeDescription keeps whatever sits above its header).
 */
import { formatStreamTitle } from "./stream-title";
import { YT_DESCRIPTION_MAX } from "./vod";

export { YT_DESCRIPTION_MAX };
/** Cap on a stored thumbnail source (URL or site-relative path). */
export const THUMBNAIL_SOURCE_MAX = 500;
/** Channel plate every broadcast falls back to (served by `public`; 1672×941,
 *  already 16:9 so the thumbnail pipeline never letterboxes it). Was the
 *  horizontal brand logo, which read as a bare wordmark on a video card. */
export const DEFAULT_THUMBNAIL_PATH = "/chan1.png";

/** One-paragraph pitch for the globe — the description body and the hydra announcement share it. */
export const DEFAULT_STREAM_BLURB =
  "This is our live weather globe — real-time global wind, temperature, storms and " +
  "severe-weather alerts, rendered live and directed automatically around breaking " +
  "weather events.";

/**
 * The built-in description template used when a run/slot has none. Date codes
 * are allowed; the site link is appended by `buildBroadcastDescription`.
 */
export const DEFAULT_STREAM_DESCRIPTION = `${DEFAULT_STREAM_BLURB}\n\nStreaming since %A %e %B %Y, %H:%M %Z.`;

/** `.env` values are single-line: a literal backslash-n becomes a newline. */
export function unescapeTemplate(raw: string): string {
  return raw.replace(/\\n/g, "\n");
}

export interface DescriptionInput {
  /** Operator template (run/slot); blank = `fallback`. */
  template?: string | null;
  /** Deployment default (env), tried before the built-in copy. */
  fallback?: string | null;
  /** Public site URL appended as a "Watch the map live" line when not already present. */
  siteUrl?: string | null;
  now?: Date;
}

/**
 * Resolve the description that goes on the broadcast at creation: the first
 * non-blank of operator template → deployment fallback → built-in copy, date
 * codes expanded, the site link appended, clamped to YouTube's limit.
 */
export function buildBroadcastDescription(input: DescriptionInput = {}): string {
  const now = input.now ?? new Date();
  const template =
    (input.template ?? "").trim() || unescapeTemplate((input.fallback ?? "").trim()) || DEFAULT_STREAM_DESCRIPTION;
  let text = formatStreamTitle(template, now).trim();
  const site = (input.siteUrl ?? "").trim().replace(/\/+$/, "");
  if (site && !text.includes(site)) text = `${text}\n\nWatch the map live: ${site}`;
  return text.length <= YT_DESCRIPTION_MAX ? text : text.slice(0, YT_DESCRIPTION_MAX).trimEnd();
}

/**
 * Validate an operator-entered thumbnail source: an absolute http(s) URL or a
 * site-relative path ("/images/x.png"). Returns the trimmed value, `undefined`
 * for blank (= use the default), or `null` when it is not usable.
 */
export function normalizeThumbnailSource(raw: unknown): string | undefined | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return undefined;
  if (s.length > THUMBNAIL_SOURCE_MAX) return null;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Absolute URL for a thumbnail source — site-relative paths resolve against the public base. */
export function resolveThumbnailUrl(source: string | undefined | null, siteUrl: string): string {
  const src = (source ?? "").trim() || DEFAULT_THUMBNAIL_PATH;
  if (/^https?:\/\//i.test(src)) return src;
  return `${siteUrl.replace(/\/+$/, "")}${src.startsWith("/") ? "" : "/"}${src}`;
}
