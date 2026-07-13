import { createHash } from "node:crypto";
import { cameraModeFromText, type VolcanoCameraMode } from "@photonsurge/shared/volcanoes/media";

export const INGV_ETNA_PAGE = "https://www.ct.ingv.it/index.php/monitoraggio-e-sorveglianza/segnali-in-tempo-reale/video-sorveglianza-vulcanica-etna";
export const INGV_AEOLIAN_PAGE = "https://www.ct.ingv.it/index.php/monitoraggio-e-sorveglianza/segnali-in-tempo-reale/video-sorveglianza-vulcanica-isole-eolie";

export interface IngvCamera {
  sourceCameraId: string; volcanoName: string; name: string; mode: VolcanoCameraMode;
  imageUrl: string; detailUrl: string;
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
const absolute = (url: string, base: string) => new URL(url.replace(/&amp;/g, "&"), base).toString();

export function discoverIngvIframes(html: string, pageUrl: string): string[] {
  return [...new Set([...html.matchAll(/<iframe\b[^>]*src=["'][^"']+["'][^>]*>/gi)]
    .map((m) => attr(m[0], "src")).filter((v): v is string => Boolean(v)).map((v) => absolute(v, pageUrl)))];
}

export function parseIngvCameraDocument(html: string, detailUrl: string, defaultVolcano: string): IngvCamera[] {
  const out: IngvCamera[] = [];
  for (const m of html.matchAll(/<(?:img|source|video)\b[^>]*(?:src|data-src)\s*=\s*["'][^"']+["'][^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, "src") ?? attr(tag, "data-src");
    if (!src || !/\.(?:jpe?g|png|webp|mjpeg)(?:[?#]|$)/i.test(src) || /logo|icon|nowork/i.test(src)) continue;
    const context = `${attr(tag, "alt") ?? ""} ${attr(tag, "title") ?? ""} ${src}`;
    const volcanoName = /stromboli/i.test(context) ? "Stromboli" : /vulcano/i.test(context) ? "Vulcano" : defaultVolcano;
    const imageUrl = absolute(src, detailUrl);
    out.push({
      sourceCameraId: createHash("sha1").update(imageUrl).digest("hex").slice(0, 16),
      volcanoName, name: context.trim() || `${volcanoName} camera`,
      mode: cameraModeFromText(context) === "UNKNOWN" && /\/[A-Za-z]*t\d*\.(?:jpe?g|png)/i.test(src) ? "THERMAL" : cameraModeFromText(context),
      imageUrl, detailUrl,
    });
  }
  return out;
}

export async function fetchIngvCameras(fetchImpl: typeof fetch = fetch): Promise<IngvCamera[]> {
  const pages = [[INGV_ETNA_PAGE, "Etna"], [INGV_AEOLIAN_PAGE, "Stromboli"]] as const;
  const out: IngvCamera[] = [];
  for (const [pageUrl, fallback] of pages) {
    const page = await fetchImpl(pageUrl);
    if (!page.ok) continue;
    const html = await page.text();
    const frames = discoverIngvIframes(html, pageUrl);
    for (const frame of frames.length ? frames : [pageUrl]) {
      const body = frame === pageUrl ? html : await fetchImpl(frame).then((r) => r.ok ? r.text() : "");
      out.push(...parseIngvCameraDocument(body, frame, fallback));
    }
  }
  return out;
}
