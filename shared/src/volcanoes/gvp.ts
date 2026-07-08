import type { Volcano, VolcanoStatus } from "./types";

/**
 * Smithsonian / USGS Weekly Volcanic Activity Report — a joint Global
 * Volcanism Program (GVP) + Volcano Hazards Program bulletin, published every
 * Thursday, keyless RSS+GeoRSS:
 *   https://volcano.si.edu/news/WeeklyVolcanoRSS.xml
 *
 * This is a genuinely current "what's actually happening this week" feed —
 * unlike NASA EONET's volcano category (tried first; dropped), which mints a
 * new per-episode event id every time a volcano re-opens and can sit stale for
 * years between updates (its Etna record, one of the world's most frequently
 * erupting volcanoes, was last touched mid-2024). Each `<item>` here reports
 * one volcano's activity for the week, with its own status label — no time-
 * window guessing needed. Each volcano's Smithsonian VOTW number (from the
 * item guid, e.g. "vn_211060" for Etna) is a STABLE per-volcano id, so re-polls
 * across weeks upsert onto the same doc instead of minting new ones.
 *
 * No dependency added for XML parsing — the feed's structure is simple and
 * stable (flat `<item>` blocks, no nested tags inside the fields we read), so
 * a small tolerant regex extractor is enough and matches this codebase's other
 * hand-rolled feed parsers (e.g. the FIRMS CSV parser).
 */
export const GVP_WEEKLY_URL = process.env.GVP_WEEKLY_URL || "https://volcano.si.edu/news/WeeklyVolcanoRSS.xml";

function extractTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : undefined;
}

/**
 * Un-escape the entities the feed uses (the description is HTML-escaped plain
 * text, not a CDATA section — its `<p>` tags read as literal `&lt;p&gt;`) and
 * THEN drop the resulting markup, in that order — stripping tags first would
 * do nothing since there are no literal angle brackets yet.
 */
function stripHtml(html: string): string {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The report's own activity label → our status tier (see VolcanoStatus). */
function statusForLabel(label: string): VolcanoStatus {
  const l = label.toLowerCase();
  if (l.includes("unrest")) return "unrest";
  if (l.includes("eruptive activity")) return "erupting";
  return "dormant";
}

// "<Name> (<Country>) - Report for <date range> - <activity label>". The
// separators around "-" require actual surrounding whitespace (`\s+`, not
// `\s*`) so a bare hyphen inside the date range itself (e.g. "25 June-1 July
// 2026") isn't mistaken for the "- Report for"/"- <label>" boundary.
const TITLE_RE = /^(.*?)\s*\(([^)]+)\)\s+-\s+Report for\s+(.*?)\s+-\s+(.+)$/;

/**
 * Parse the weekly RSS into `Volcano[]`. Items missing a title match, a stable
 * volcano-number guid, or a usable coordinate are skipped.
 */
export function parseGvpWeekly(xml: string, nowMs: number): Volcano[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out: Volcano[] = [];

  for (const item of items) {
    const rawTitle = extractTag(item, "title");
    const guid = extractTag(item, "guid");
    const point = extractTag(item, "georss:point");
    const pubDate = extractTag(item, "pubDate");
    const description = extractTag(item, "description");
    if (!rawTitle || !guid || !point) continue;

    const titleMatch = rawTitle.match(TITLE_RE);
    if (!titleMatch) continue;
    const [, name, country, reportDateRange, activityLabel] = titleMatch;

    const idMatch = guid.match(/vn_(\d+)/);
    if (!idMatch) continue;
    const volcanoNumber = idMatch[1];

    const [latStr, lngStr] = point.split(/\s+/); // georss:point is "lat lon"
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const reportMs = pubDate ? Date.parse(pubDate) : NaN;
    const lastDate = Number.isFinite(reportMs) ? reportMs : nowMs;

    out.push({
      id: `gvp:${volcanoNumber}`,
      name: name.trim(),
      country: country.trim(),
      lat,
      lng,
      status: statusForLabel(activityLabel),
      firstDate: lastDate,
      lastDate,
      // Placeholder — like firstDate, only meaningful on a brand-new volcano's
      // first insert. The repo's pipeline-update upsert (see volcano-repo.ts)
      // computes the real value server-side from the previously stored status
      // and never reads this field, so any re-poll's value here is ignored.
      statusChangedAt: lastDate,
      sourceUrl: `https://volcano.si.edu/volcano.cfm?vn=${volcanoNumber}`,
      latestReport: description ? stripHtml(description) : undefined,
      reportDateRange: reportDateRange.trim(),
    });
  }
  return out;
}

/**
 * Fetch + parse the current weekly bulletin for the whole globe. The feed
 * declares ISO-8859-1 — decoded via Buffer's built-in `latin1` (a direct byte-
 * to-codepoint mapping, no ICU dependency) so accented names don't mangle.
 */
export async function fetchVolcanoes(fetchImpl: typeof fetch = fetch): Promise<{ volcanoes: Volcano[] }> {
  const res = await fetchImpl(GVP_WEEKLY_URL);
  if (!res.ok) throw new Error(`gvp weekly ${res.status}`);
  const xml = Buffer.from(await res.arrayBuffer()).toString("latin1");
  return { volcanoes: parseGvpWeekly(xml, Date.now()) };
}
