import type { VolcanoMediaType } from "@photonsurge/shared/volcanoes/media";

export interface GvpImage { sourceMediaId: string; title?: string; caption?: string; imageUrl: string; sourceUrl: string; attribution?: string; licence: string; reuseAllowed: boolean; type: VolcanoMediaType }
const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
const plain = (html: string) => html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();

export function discoverGvpImageDetails(html: string, volcanoUrl: string): string[] {
  return [...new Set([...html.matchAll(/<a\b[^>]*href=["'][^"']*ShowImage\.cfm\?photo=[^"']+["'][^>]*>/gi)]
    .map((m) => attr(m[0], "href")).filter((v): v is string => Boolean(v)).map((v) => new URL(v.replace(/&amp;/g, "&"), volcanoUrl).toString()))];
}

export function parseGvpImageDetail(html: string, sourceUrl: string): GvpImage | null {
  const id = /[?&]photo=([^&#]+)/i.exec(sourceUrl)?.[1];
  const image = [...html.matchAll(/<img\b[^>]*(?:src|data-src)=["'][^"']+["'][^>]*>/gi)]
    .map((m) => attr(m[0], "src") ?? attr(m[0], "data-src"))
    .find((v) => v && !/logo|icon|header/i.test(v) && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(v));
  if (!id || !image) return null;
  const body = plain(html);
  const rights = /public domain/i.test(body) ? "Public Domain"
    : /CC BY-SA 4\.0/i.test(body) ? "CC BY-SA 4.0" : "All Rights Reserved";
  return { sourceMediaId: id, title: /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] && plain(RegExp.$1),
    caption: /Caption:?\s*([\s\S]{1,1000}?)(?:Credit|Copyright|Rights|$)/i.exec(body)?.[1]?.trim(),
    imageUrl: new URL(image, sourceUrl).toString(), sourceUrl,
    attribution: /(?:Credit|Photo by):?\s*([^|]{2,200})/i.exec(body)?.[1]?.trim(), licence: rights,
    reuseAllowed: rights === "Public Domain" || rights === "CC BY-SA 4.0", type: "PHOTO" };
}

export async function fetchGvpImages(volcanoUrl: string, fetchImpl: typeof fetch = fetch): Promise<GvpImage[]> {
  const page = await fetchImpl(volcanoUrl); if (!page.ok) return [];
  const details = discoverGvpImageDetails(await page.text(), volcanoUrl); const out: GvpImage[] = [];
  for (const url of details) { const res = await fetchImpl(url); if (!res.ok) continue; const image = parseGvpImageDetail(await res.text(), url); if (image) out.push(image); }
  return out;
}
