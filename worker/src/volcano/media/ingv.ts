import { timeoutFetch } from "../../http";
import { createHash } from "node:crypto";
import { cameraModeFromText, type VolcanoCameraMode } from "@photonsurge/shared/volcanoes/media";

export const INGV_ETNA_PAGE = "https://www.ct.ingv.it/index.php/monitoraggio-e-sorveglianza/segnali-in-tempo-reale/video-sorveglianza-vulcanica-etna";
export const INGV_AEOLIAN_PAGE = "https://www.ct.ingv.it/index.php/monitoraggio-e-sorveglianza/segnali-in-tempo-reale/video-sorveglianza-vulcanica-isole-eolie";

export interface IngvCamera {
  sourceCameraId: string; volcanoName: string; name: string; mode: VolcanoCameraMode;
  imageUrl: string; detailUrl: string; observedAt?: string;
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
const absolute = (url: string, base: string) => new URL(url.replace(/&amp;/g, "&"), base).toString();

export function discoverIngvIframes(html: string, pageUrl: string): string[] {
  return [...new Set([...html.matchAll(/<iframe\b[^>]*src=["'][^"']+["'][^>]*>/gi)]
    .map((m) => attr(m[0], "src")).filter((v): v is string => Boolean(v)).map((v) => absolute(v, pageUrl)))];
}

export function parseIngvCameraDocument(html: string, detailUrl: string, defaultVolcano: string): IngvCamera[] {
  const byStation = new Map<string, IngvCamera>();
  for (const m of html.matchAll(/<(?:img|source|video)\b[^>]*(?:src|data-src)\s*=\s*["'][^"']+["'][^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, "src") ?? attr(tag, "data-src");
    if (!src || !/\.(?:jpe?g|png|webp|mjpeg)(?:[?#]|$)/i.test(src) || /logo|icon|nowork/i.test(src)) continue;
    const context = `${attr(tag, "alt") ?? ""} ${attr(tag, "title") ?? ""} ${src}`;
    const volcanoName = /stromboli/i.test(context) ? "Stromboli" : /vulcano/i.test(context) ? "Vulcano" : defaultVolcano;
    const imageUrl = absolute(src, detailUrl);
    const station = /\/webcams\/([^/]+)/i.exec(src)?.[1] ?? /\/([A-Za-z]{2,8})\d{3,6}\.(?:jpe?g|png)/i.exec(src)?.[1];
    const stableId = station?.toLowerCase() ?? createHash("sha1").update(imageUrl.split("?")[0]).digest("hex").slice(0, 16);
    const stamp = /\/(20\d{6})\/(\d{4})\//.exec(src);
    const observedAt = stamp ? `${stamp[1].slice(0, 4)}-${stamp[1].slice(4, 6)}-${stamp[1].slice(6, 8)}T${stamp[2].slice(0, 2)}:${stamp[2].slice(2, 4)}:00+02:00` : undefined;
    const camera = {
      sourceCameraId: stableId,
      volcanoName, name: station ? `${volcanoName} · ${station}` : (context.trim() || `${volcanoName} camera`),
      mode: cameraModeFromText(context) === "UNKNOWN" && /\/[A-Za-z]*t\d*\.(?:jpe?g|png)/i.test(src) ? "THERMAL" : cameraModeFromText(context),
      imageUrl, detailUrl, observedAt,
    };
    const previous = byStation.get(stableId);
    if (!previous || `${camera.observedAt ?? ""}|${camera.imageUrl}` > `${previous.observedAt ?? ""}|${previous.imageUrl}`) byStation.set(stableId, camera);
  }
  return [...byStation.values()];
}

export async function fetchIngvCameras(fetchImpl: typeof fetch = timeoutFetch()): Promise<IngvCamera[]> {
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
