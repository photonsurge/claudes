/**
 * Title / description / thumbnail templates for rendered videos (short-video
 * plan §6.8). Pure: no I/O — shared by the format editor (token picker and
 * preview) and the render queue (which resolves the text onto the run).
 *
 * A template takes every single-letter date code a live title takes (see
 * ./stream-title) plus the video's own values, written `%{name}`. Both are
 * resolved in ONE pass, so a `%` inside a substituted value is never expanded
 * again ("100% rain" stays "100% rain").
 *
 * - An unknown or missing `%{name}` resolves to the empty string, so a template
 *   written for a richer script never leaks raw codes onto YouTube.
 * - An unknown single-letter code (`%q`) and a lone `%` are left as written,
 *   exactly as in live titles; `%%` is a literal percent.
 */
import { clipYouTubeDescription, YT_DESCRIPTION_MAX } from "./stream-description";
import { dateCodeValues, STREAM_TITLE_TIMEZONE, STREAM_TITLE_TOKENS } from "./stream-title";

export { clipYouTubeDescription, YT_DESCRIPTION_MAX, STREAM_TITLE_TOKENS };

/** Date codes resolve in London time unless the format names another zone (§6.8). */
export const VIDEO_TEXT_TIMEZONE = STREAM_TITLE_TIMEZONE;
/** YouTube's cap on a video title, in characters. */
export const YT_TITLE_MAX = 100;

/**
 * The video's own codes, as `[code, label, example]` — the same shape as
 * STREAM_TITLE_TOKENS so the token picker can render both groups alike.
 */
export const VIDEO_TEXT_TOKENS = [
  ["%{place}", "Place name (or the list)", "United Kingdom"],
  ["%{placeId}", "Place id (safe for paths)", "gb"],
  ["%{places}", "Number of places", "6"],
  ["%{flag}", "Country flag", "🇬🇧"],
  ["%{kind}", "What the video is", "round-up"],
  ["%{format}", "Format name", "Country round-up"],
  ["%{duration}", "Video length", "1:45"],
  ["%{asOf}", "Round-up written at (local)", "06:00"],
  ["%{headline}", "Round-up first sentence", "Storms sweep in from the west."],
  ["%{roundup}", "Round-up text", "Storms sweep in from the west…"],
  ["%{alerts}", "Active alerts", "12"],
  ["%{quakes}", "Recent earthquakes", "3"],
  ["%{volcanoes}", "Active volcanoes", "1"],
  ["%{top}", "Top event title", "Red wind warning"],
  ["%{n}", "Running number", "214"],
] as const;

/** A `%{name}` code's name, without the braces. */
export type VideoTextName = (typeof VIDEO_TEXT_TOKENS)[number][0] extends `%{${infer N}}` ? N : never;
export const VIDEO_TEXT_NAMES: readonly VideoTextName[] = VIDEO_TEXT_TOKENS.map(
  ([code]) => code.slice(2, -1) as VideoTextName,
);
/** Values for the `%{name}` codes; extra keys are allowed (and resolve too). */
export type VideoTextValues = Partial<Record<VideoTextName, string>> & Record<string, string | undefined>;

/** True when Intl knows `zone` as an IANA time zone. */
export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve `%{name}` and the date codes in one pass. `timeZone` is an IANA zone
 * (London by default); an unknown zone throws a RangeError — check it with
 * `isValidTimeZone` first when it comes from an operator.
 */
export function formatVideoText(
  template: string,
  values: VideoTextValues = {},
  date: Date = new Date(),
  timeZone: string = VIDEO_TEXT_TIMEZONE,
): string {
  const dates = dateCodeValues(date, timeZone);
  return template.replace(/%(?:\{([A-Za-z][A-Za-z0-9]*)\}|([%a-zA-Z]))/g, (match, name?: string, key?: string) => {
    if (name !== undefined) return Object.prototype.hasOwnProperty.call(values, name) ? values[name] ?? "" : "";
    return dates[key!] ?? match;
  });
}

/**
 * Fit a title to YouTube's 100 characters: cut at the last word boundary with
 * an ellipsis (a single over-long word is cut hard). Counts code points, so an
 * emoji flag is never split in half.
 */
export function trimVideoTitle(title: string, max: number = YT_TITLE_MAX): string {
  const text = title.trim();
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max - 1).join("");
  // The head already ends on a whole word when the next character is a space.
  const space = /\s/.test(chars[max - 1]) ? head.length : head.search(/\s\S*$/);
  const cut = (space > 0 ? head.slice(0, space) : head).replace(/[\s,;:·–—-]+$/u, "");
  return `${cut || head}…`;
}
