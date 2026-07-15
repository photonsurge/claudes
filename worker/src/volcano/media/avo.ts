import { timeoutFetch } from "../../http";
import { cameraModeFromText, type VolcanoCameraMode } from "@photonsurge/shared/volcanoes/media";

export const AVO_WEBCAM_INDEX = "https://avo.alaska.edu/webcam/";

export interface AvoCameraIndexEntry {
  sourceCameraId: string;
  volcanoName: string;
  name: string;
  mode: VolcanoCameraMode;
  detailUrl: string;
  upstreamTimestamp?: string;
}

export interface AvoCameraDetail extends AvoCameraIndexEntry {
  latitude?: number;
  longitude?: number;
  bearing?: number;
  currentImageUrl?: string;
  video12hUrl?: string;
}

const text = (html: string) => html
  .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/\s+/g, " ")
  .trim();

const absolute = (value: string, base: string) => new URL(value.replace(/&amp;/g, "&"), base).toString();
const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];

/** Pure parser: h2 headings establish the volcano associated with following camera links. */
export function parseAvoCameraIndex(html: string, base = AVO_WEBCAM_INDEX): AvoCameraIndexEntry[] {
  const tokens = [...html.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2>|<a\b[^>]*href\s*=\s*["'][^"']*(?:\/webcam\/)?view\/\d+[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)];
  const out: AvoCameraIndexEntry[] = [];
  const seen = new Set<string>();
  let volcanoName = "";
  for (const match of tokens) {
    const tag = match[0];
    if (/^<h2\b/i.test(tag)) {
      volcanoName = text(tag);
      continue;
    }
    const href = attr(tag, "href");
    const id = href && /(?:\/webcam\/)?view\/(\d+)/i.exec(href)?.[1];
    if (!id || !volcanoName || seen.has(id)) continue;
    seen.add(id);
    const label = text(tag);
    const timestamp = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+UTC)/i.exec(label)?.[1];
    const name = label.replace(/\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}[\s\S]*$/i, "").trim();
    out.push({ sourceCameraId: id, volcanoName, name: name || id, mode: cameraModeFromText(name),
      detailUrl: absolute(href, base), upstreamTimestamp: timestamp });
  }
  return out;
}

/** Pure detail parser. URLs remain discovered from the page, never constructed. */
export function parseAvoCameraDetail(entry: AvoCameraIndexEntry, html: string): AvoCameraDetail {
  const body = text(html);
  const number = (label: string) => {
    const value = new RegExp(`${label}:?\\s*(-?\\d+(?:\\.\\d+)?)`, "i").exec(body)?.[1];
    return value == null ? undefined : Number(value);
  };
  const links = [...html.matchAll(/<(?:a|img|source)\b[^>]*(?:href|src)=["'][^"']+["'][^>]*>/gi)]
    .map((m) => ({ tag: m[0], url: attr(m[0], "href") ?? attr(m[0], "src") }))
    .filter((x): x is { tag: string; url: string } => Boolean(x.url));
  const image = links.find((x) => /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(x.url) && !/logo|icon/i.test(x.url));
  const video = links.find((x) => /\.(?:mp4|webm)(?:[?#]|$)/i.test(x.url) || /download\s+video/i.test(text(x.tag)));
  return {
    ...entry,
    latitude: number("Latitude"),
    longitude: number("Longitude"),
    bearing: number("Bearing"),
    currentImageUrl: image ? absolute(image.url, entry.detailUrl) : undefined,
    video12hUrl: video ? absolute(video.url, entry.detailUrl) : undefined,
    upstreamTimestamp: /Last Image:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+UTC)/i.exec(body)?.[1] ?? entry.upstreamTimestamp,
  };
}

export async function fetchAvoCameraRegistry(fetchImpl: typeof fetch = timeoutFetch()): Promise<AvoCameraDetail[]> {
  const indexRes = await fetchImpl(AVO_WEBCAM_INDEX);
  if (!indexRes.ok) throw new Error(`AVO webcam index ${indexRes.status}`);
  const entries = parseAvoCameraIndex(await indexRes.text());
  const out: AvoCameraDetail[] = [];
  // AVO currently exposes dozens of cameras. Bound concurrency avoids a slow
  // serial registry run without opening an abusive connection burst.
  const queue = [...entries];
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => {
    for (;;) {
      const entry = queue.shift();
      if (!entry) return;
      const res = await fetchImpl(entry.detailUrl);
      if (res.ok) out.push(parseAvoCameraDetail(entry, await res.text()));
    }
  }));
  return out;
}
