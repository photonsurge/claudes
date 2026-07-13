import { createHash } from "node:crypto";
import { cameraModeFromText, type VolcanoCameraMode } from "@photonsurge/shared/volcanoes/media";

export const MAGMA_CCTV_URL = "https://magma.esdm.go.id/v1/gunung-api/cctv";
export interface MagmaCamera { sourceCameraId: string; volcanoName: string; name: string; mode: VolcanoCameraMode; imageUrl: string; detailUrl: string }
const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export function parseMagmaCameras(html: string, pageUrl = MAGMA_CCTV_URL): MagmaCamera[] {
  const out: MagmaCamera[] = [];
  for (const block of html.matchAll(/<(?:article|div|figure)\b[^>]*>[\s\S]{0,3000}?<img\b[^>]+>[\s\S]{0,1000}?<\/(?:article|div|figure)>/gi)) {
    const imageTag = /<img\b[^>]+>/i.exec(block[0])?.[0];
    const src = imageTag && (attr(imageTag, "src") ?? attr(imageTag, "data-src"));
    const label = plain(block[0]);
    const match = /(?:View\s+)?(.+?)\s+-\s+([^|]{2,120}?)(?=\s{2,}|$)/i.exec(label);
    if (!src || !match || /logo|icon/i.test(src)) continue;
    const volcanoName = match[1].trim(); const name = `${volcanoName} - ${match[2].trim()}`;
    const imageUrl = new URL(src, pageUrl).toString();
    out.push({ sourceCameraId: createHash("sha1").update(imageUrl.split("?")[0]).digest("hex").slice(0, 16),
      volcanoName, name, mode: cameraModeFromText(name), imageUrl, detailUrl: pageUrl });
  }
  return out;
}

export async function fetchMagmaCameras(fetchImpl: typeof fetch = fetch): Promise<MagmaCamera[]> {
  const res = await fetchImpl(MAGMA_CCTV_URL); if (!res.ok) throw new Error(`MAGMA CCTV ${res.status}`);
  return parseMagmaCameras(await res.text());
}
