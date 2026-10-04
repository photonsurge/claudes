/**
 * VOD as-run helpers — placing the director's as-run cuts on a YouTube video's
 * timeline (docs/vod-as-run-plan.md). Pure and clock-free so the
 * /api/streams/:id/asrun route (which computes offsets server-side) and the
 * admin page (which only formats them) agree to the millisecond.
 *
 * Time base: a VOD's `t=0` is the instant YouTube put the broadcast live
 * (videos.list liveStreamingDetails.actualStartTime), which the worker stamps
 * onto the run. Until that lands, the worker's own go-live stamp (`startAt`) is
 * the fallback — same second give or take. `leadMs` is the fixed
 * browser→OBS→RTMP→YouTube pipeline delay: a frame captured at our-clock `C`
 * reaches YouTube at `C + lead`, so it sits at `t = C − base + lead` in the
 * video — cuts land LATER in the VOD than on our clock, never earlier.
 */

export interface VideoTimeBase {
  /** Our-clock instant that maps to t=0 of the video. */
  baseMs: number;
  source: "youtube" | "run";
}

type RunLike = {
  startAt?: number | null;
  platforms?: { youtube?: { actualStartTime?: number | null } | null };
};

/** Null when the run never went live (no instant to anchor t=0 on). */
export function videoTimeBase(run: RunLike): VideoTimeBase | null {
  const yt = run.platforms?.youtube?.actualStartTime;
  if (typeof yt === "number" && Number.isFinite(yt) && yt > 0) return { baseMs: yt, source: "youtube" };
  const own = run.startAt;
  if (typeof own === "number" && Number.isFinite(own) && own > 0) return { baseMs: own, source: "run" };
  return null;
}

/** Video offset (ms from t=0) of an our-clock instant; never negative. */
export function vodOffsetMs(atMs: number, baseMs: number, leadMs = 0): number {
  return Math.max(0, atMs - baseMs + leadMs);
}

/** The our-clock instant that maps to t=0 of the video (the inverse of vodOffsetMs). */
export function videoStartOnOurClock(baseMs: number, leadMs = 0): number {
  return baseMs - leadMs;
}

type WindowedRun = { startAt?: number | null; endedAt?: number | null; status: string };

/**
 * Streaming runs whose on-air span overlaps [fromMs, toMs) — the reverse join,
 * from a director session to the video(s) it aired on. A run that never went
 * live (no startAt) can't have aired anything; one still running reaches `nowMs`.
 */
export function runsOverlapping<R extends WindowedRun>(runs: R[], fromMs: number, toMs: number, nowMs = Date.now()): R[] {
  return runs.filter((r) => {
    if (typeof r.startAt !== "number" || !Number.isFinite(r.startAt)) return false;
    const end = typeof r.endedAt === "number" ? r.endedAt : r.status === "live" || r.status === "ending" ? nowMs : r.startAt;
    return r.startAt < toMs && end > fromMs;
  });
}

/** YouTube-style offset: "1:23:45" past the hour, else "3:07". */
export function fmtOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** The watch URL opened at an offset (`&t=123s`). */
export function vodSeekUrl(watchUrl: string, offsetMs: number): string {
  const sep = watchUrl.includes("?") ? "&" : "?";
  return `${watchUrl}${sep}t=${Math.floor(Math.max(0, offsetMs) / 1000)}s`;
}

/** Gaps shorter than this are cut-to-cut rounding, not operator time. */
export const GAP_MIN_MS = 1500;

export type AsRunGapReason = "before-first-cut" | "between-cuts" | "after-last-cut";

/**
 * One row of the video's as-run timeline: either a director cut placed at its
 * video offset, or a stretch with no cut logged (the operator drove by hand, or
 * auto was off) — drawn explicitly so the rows add up to the video's length.
 */
export type AsRunItem<E> =
  | {
      type: "cut";
      entry: E;
      offsetMs: number;
      /** Null while the shot is still on air (live run, open entry). */
      endOffsetMs: number | null;
      /** The shot was already on air when the video started. */
      clippedStart: boolean;
      /** The shot was still on air when the video ended. */
      clippedEnd: boolean;
    }
  | { type: "gap"; offsetMs: number; endOffsetMs: number; reason: AsRunGapReason };

type EntryLike = { startedAt: Date | string | number; endedAt?: Date | string | number | null };

const ms = (v: Date | string | number): number => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/**
 * Lay a scene's cuts over a video window. `fromMs`/`toMs` are our-clock bounds
 * of the video (`toMs` null while the run is live → `nowMs`); `baseMs` is t=0.
 * Entries are expected from `airLog.listEntriesInWindow` — anything fully
 * outside the window is dropped defensively.
 */
export function buildAsRunTimeline<E extends EntryLike>(
  entries: E[],
  window: { fromMs: number; toMs: number | null; baseMs: number; leadMs?: number; nowMs?: number },
): AsRunItem<E>[] {
  const from = window.fromMs;
  const live = window.toMs == null;
  const to = window.toMs ?? window.nowMs ?? Date.now();
  const lead = window.leadMs ?? 0;
  const off = (t: number) => vodOffsetMs(t, window.baseMs, lead);
  const items: AsRunItem<E>[] = [];
  let cursor = from;

  const sorted = [...entries].sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
  for (const entry of sorted) {
    const s = ms(entry.startedAt);
    const e = entry.endedAt == null ? null : ms(entry.endedAt);
    const vs = Math.max(s, from);
    // An open entry on a finished run is a stale log (worker died mid-shot):
    // clip it at the video's end rather than pretend it's still on air.
    const ve = e == null ? (live ? null : to) : Math.min(e, to);
    if (vs >= to || (ve != null && ve <= vs)) continue;

    if (vs - cursor > GAP_MIN_MS) {
      items.push({
        type: "gap",
        offsetMs: off(cursor),
        endOffsetMs: off(vs),
        reason: cursor === from ? "before-first-cut" : "between-cuts",
      });
    }
    items.push({
      type: "cut",
      entry,
      offsetMs: off(vs),
      endOffsetMs: ve == null ? null : off(ve),
      clippedStart: s < from,
      clippedEnd: e == null ? !live : e > to,
    });
    cursor = ve ?? to;
    if (ve == null) break; // the shot on air now is by definition the last row
  }

  if (to - cursor > GAP_MIN_MS) {
    items.push({
      type: "gap",
      offsetMs: off(cursor),
      endOffsetMs: off(to),
      reason: cursor === from ? "before-first-cut" : "after-last-cut",
    });
  }
  return items;
}

// ---- YouTube chapters (docs/vod-as-run-plan.md §4) ----

/** YouTube's rules: first stamp at 0:00, chapters ≥ 10 s, ascending; description ≤ 5,000 chars. */
export const YT_CHAPTER_MIN_MS = 10_000;
export const YT_DESCRIPTION_MAX = 5_000;
/** Heads the block we own in a description; re-publishing replaces from here down. */
export const CHAPTERS_HEADER = "⏱ As aired";
const CHAPTER_LABEL_MAX = 80;

export interface ChapterEntryLike {
  segmentId: string;
  kind: string;
  title: string;
  subtitle?: string;
  icon?: string;
  breaking?: boolean;
  timesShown?: number;
}

export interface Chapter {
  offsetMs: number;
  label: string;
  /** The stamp + label as it goes in the description, e.g. "1:23:45 🚨 M6.1 earthquake · Fiji". */
  line: string;
}

/**
 * The marker on a breaking pick. NOT a lightning bolt: the label puts it right
 * next to the hazard's own icon ("⚡ 🔥 Extreme Fire Danger"), where a bolt
 * reads as a thunderstorm rather than as "we broke into this".
 */
export const BREAKING_MARK = "🚨";

/** One short, on-air-safe label per cut. `subtitles: false` leaves the
 *  subtitle off — a scripted video's chapters are its places ("🇺🇸 United
 *  States"), not the shot's caption ("Country tour · National weather"). */
export function chapterLabel(e: ChapterEntryLike, opts: { subtitles?: boolean } = {}): string {
  const parts = [e.breaking ? BREAKING_MARK : "", e.icon ?? "", e.title.trim()].filter(Boolean);
  let label = parts.join(" ");
  if (opts.subtitles !== false && e.subtitle?.trim()) label += ` · ${e.subtitle.trim()}`;
  label = label.replace(/\s+/g, " ");
  return label.length > CHAPTER_LABEL_MAX ? `${label.slice(0, CHAPTER_LABEL_MAX - 1).trimEnd()}…` : label;
}

/**
 * Turn a video's as-run timeline into a chapter list that fits `maxChars`.
 * Consecutive cuts on the same subject merge into one chapter; anything shorter
 * than YouTube's 10 s floor is dropped; when the budget can't hold everything
 * (a 24 h stream is thousands of cuts) the keepers are breaking picks first,
 * then first airings, then the longest holds — re-sorted by offset at the end.
 * A chapter always opens at 0:00 (`openingLabel` fills it when the first cut
 * came later), so YouTube renders the list as chapters, not just timestamps.
 */
export function buildChapters<E extends ChapterEntryLike>(
  items: AsRunItem<E>[],
  opts: { maxChars: number; openingLabel: string; subtitles?: boolean },
): Chapter[] {
  const labelOf = (e: E) => chapterLabel(e, { subtitles: opts.subtitles });
  type Cand = { offsetMs: number; endMs: number; entry: E; rank: number };
  const merged: Cand[] = [];
  for (const it of items) {
    if (it.type !== "cut") continue;
    const endMs = it.endOffsetMs ?? it.offsetMs;
    const prev = merged[merged.length - 1];
    if (prev && prev.entry.segmentId === it.entry.segmentId && it.offsetMs - prev.endMs <= GAP_MIN_MS) {
      prev.endMs = Math.max(prev.endMs, endMs);
      continue;
    }
    merged.push({ offsetMs: it.offsetMs, endMs, entry: it.entry, rank: 0 });
  }

  const long = merged.filter((c) => c.endMs - c.offsetMs >= YT_CHAPTER_MIN_MS);
  if (long.length && long[0].offsetMs < YT_CHAPTER_MIN_MS) long[0].offsetMs = 0; // snap: no sub-10 s opener
  for (const c of long) {
    const first = (c.entry.timesShown ?? 1) <= 1;
    c.rank = (c.entry.breaking ? 2_000_000_000 : 0) + (first ? 1_000_000_000 : 0) + Math.min(999_999_999, c.endMs - c.offsetMs);
  }

  const toLine = (offsetMs: number, label: string) => `${fmtOffset(offsetMs)} ${label}`;
  const needsOpener = !long.length || long[0].offsetMs > 0;
  const opener = needsOpener ? toLine(0, opts.openingLabel) : null;
  let used = opener ? opener.length + 1 : 0;

  const kept: Cand[] = [];
  for (const c of [...long].sort((a, b) => b.rank - a.rank || a.offsetMs - b.offsetMs)) {
    const line = toLine(c.offsetMs, labelOf(c.entry));
    if (used + line.length + 1 > opts.maxChars) continue;
    used += line.length + 1;
    kept.push(c);
  }
  kept.sort((a, b) => a.offsetMs - b.offsetMs);

  const out: Chapter[] = [];
  if (opener) out.push({ offsetMs: 0, label: opts.openingLabel, line: opener });
  for (const c of kept) {
    const label = labelOf(c.entry);
    out.push({ offsetMs: c.offsetMs, label, line: toLine(c.offsetMs, label) });
  }
  return out;
}

/** The operator's part of a description: everything above our chapter block. */
export function ownDescriptionText(existing: string | null | undefined): string {
  const text = existing ?? "";
  const idx = text.indexOf(CHAPTERS_HEADER);
  return (idx >= 0 ? text.slice(0, idx) : text).trimEnd();
}

/**
 * Characters the chapter lines may use once the operator's text, the header
 * and the footer have their share of YouTube's cap. Never starves the list:
 * composeDescription trims the operator's text before dropping chapters.
 */
export function chapterBudget(existing: string | null | undefined, footer?: string, minChapterChars = 1500): number {
  const fixed = CHAPTERS_HEADER.length + 1 + (footer ? footer.length + 2 : 0);
  const own = ownDescriptionText(existing);
  const room = YT_DESCRIPTION_MAX - fixed - (own ? own.length + 2 : 0);
  return Math.max(minChapterChars, room);
}

/**
 * The description with our chapter block replaced/appended: whatever the
 * operator wrote stays above the header verbatim; from the header down is ours.
 * Trims the operator text only if the whole thing would still overflow.
 */
export function composeDescription(existing: string | null | undefined, chapters: Chapter[], footer?: string): string {
  const own = ownDescriptionText(existing);
  const block = [CHAPTERS_HEADER, ...chapters.map((c) => c.line), ...(footer ? ["", footer] : [])].join("\n");
  const joined = own ? `${own}\n\n${block}` : block;
  if (joined.length <= YT_DESCRIPTION_MAX) return joined;
  const room = YT_DESCRIPTION_MAX - block.length - 2;
  return room > 0 ? `${own.slice(0, room).trimEnd()}\n\n${block}` : block.slice(0, YT_DESCRIPTION_MAX);
}

// ---- Archive eligibility ----

/** YouTube does not archive live streams that run 12 h or longer — no VOD at all. */
export const YT_ARCHIVE_MAX_MS = 12 * 60 * 60_000;

/**
 * True when a constant stream's recycle cadence means its videos will have no
 * VOD (never recycled, or recycled at 12 h or more) — the as-run page's player
 * and its chapters would then point at nothing.
 */
export function vodArchiveAtRisk(restartEveryMs: number | null | undefined): boolean {
  return !restartEveryMs || restartEveryMs >= YT_ARCHIVE_MAX_MS;
}
