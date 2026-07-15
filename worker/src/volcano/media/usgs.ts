import { timeoutFetch } from "../../http";
import { cameraModeFromText, type VolcanoCameraMode } from "@photonsurge/shared/volcanoes/media";

export const USGS_VHP_WEBCAMS = "https://www.usgs.gov/programs/VHP/multimedia/webcams";
export const USGS_ASHCAM_API = "https://volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams";

export interface UsgsCameraRecord {
  sourceCameraId: string;
  name: string;
  description?: string;
  mode: VolcanoCameraMode;
  detailUrl: string;
  currentImageUrl?: string;
  gif24hUrl?: string;
  attribution: string;
  licence: string;
  reuseAllowed: boolean;
}
export interface UsgsDiagnostic { stage: "page" | "parse" | "detail"; url: string; status?: number; reason: string }

const value = (row: Record<string, unknown>, ...keys: string[]) => keys.map((key) => row[key]).find((v) => v != null && v !== "");
const number = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };

/** Tolerant parser for the public Ashcam support API. Field casing has varied. */
export function parseUsgsAshcam(payload: unknown): Array<UsgsCameraRecord & { volcanoNumber?: string; volcanoName?: string; latitude?: number; longitude?: number }> {
  const root = payload as Record<string, unknown>;
  const rows = Array.isArray(payload) ? payload : Array.isArray(root?.webcams) ? root.webcams : Array.isArray(root?.data) ? root.data : [];
  return rows.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const code = String(value(row, "webcamCode", "webcam_code", "code") ?? "").trim();
    if (!code) return [];
    const name = String(value(row, "webcamName", "webcam_name", "name") ?? code).trim();
    const image = value(row, "newestImageUrl", "newest_image_url", "imageUrl", "image_url", "newestImage");
    const external = value(row, "externalUrl", "external_url");
    const imageUrl = typeof image === "string" && /^https?:\/\//i.test(image) ? image : undefined;
    return [{ sourceCameraId: code, name, description: typeof row.description === "string" ? row.description : undefined,
      mode: cameraModeFromText(`${name} ${String(row.description ?? "")}`),
      detailUrl: typeof external === "string" && /^https?:\/\//i.test(external) ? external : `https://volcview.wr.usgs.gov/ashcam-gui/webcam.html?webcam=${encodeURIComponent(code)}`,
      currentImageUrl: imageUrl, attribution: "U.S. Geological Survey Volcano Hazards Program", licence: "Public Domain", reuseAllowed: true,
      volcanoNumber: String(value(row, "vnum", "volcanoNumber", "volcano_number") ?? "").replace(/^gvp:/, "") || undefined,
      volcanoName: String(value(row, "vName", "volcanoName", "volcano_name") ?? "").trim() || undefined,
      latitude: number(value(row, "latitude", "lat")), longitude: number(value(row, "longitude", "lng", "lon")) }];
  });
}

export async function fetchUsgsAshcam(fetchImpl: typeof fetch = timeoutFetch()) {
  const response = await fetchImpl(USGS_ASHCAM_API, { headers: { accept: "application/json", "user-agent": "WeatherChannel volcano media registry" } });
  if (!response.ok) throw new Error(`USGS Ashcam API ${response.status}`);
  return parseUsgsAshcam(await response.json());
}

const plain = (html: string) => html.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
const absolute = (url: string, base: string) => new URL(url.replace(/&amp;/g, "&"), base).toString();

/** Camera detail links are discovered from a volcano's official webcam page. */
export function parseUsgsVolcanoWebcams(html: string, pageUrl: string): UsgsCameraRecord[] {
  const out: UsgsCameraRecord[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = match[0];
    const label = plain(tag);
    const code = /\[([A-Z0-9]+cam)\]/i.exec(label)?.[1];
    const href = attr(tag, "href");
    if (!code || !href || seen.has(code.toLowerCase())) continue;
    seen.add(code.toLowerCase());
    out.push({
      sourceCameraId: code,
      name: label,
      mode: cameraModeFromText(label),
      detailUrl: absolute(href, pageUrl),
      attribution: "U.S. Geological Survey Volcano Hazards Program",
      licence: "Public Domain",
      reuseAllowed: true,
    });
  }
  return out;
}

/** Follow a discovered camera record and locate current still + optional 24h GIF. */
export function parseUsgsCameraDetail(camera: UsgsCameraRecord, html: string): UsgsCameraRecord {
  const links = [...html.matchAll(/<(?:a|img|source)\b[^>]*(?:href|src)=["'][^"']+["'][^>]*>/gi)]
    .map((m) => ({ tag: m[0], url: attr(m[0], "href") ?? attr(m[0], "src") }))
    .filter((x): x is { tag: string; url: string } => Boolean(x.url));
  const gif = links.find((x) => /\.gif(?:[?#]|$)/i.test(x.url) && /24|hour|animation|loop/i.test(`${plain(x.tag)} ${x.url}`));
  const image = links.find((x) => /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(x.url) && !/logo|icon|avatar/i.test(x.url));
  const body = plain(html);
  const usage = /Sources?\/Usage:?\s*([^|]{1,120})/i.exec(body)?.[1]?.trim();
  const isPublicDomain = /public domain/i.test(usage ?? body);
  return {
    ...camera,
    description: /Description:?\s*([\s\S]{1,500}?)(?:Sources?\/Usage|$)/i.exec(body)?.[1]?.trim(),
    currentImageUrl: image ? absolute(image.url, camera.detailUrl) : undefined,
    gif24hUrl: gif ? absolute(gif.url, camera.detailUrl) : undefined,
    licence: isPublicDomain ? "Public Domain" : "VERIFY",
    reuseAllowed: isPublicDomain,
  };
}

export async function fetchUsgsVolcanoWebcams(pageUrl: string, fetchImpl: typeof fetch = timeoutFetch(),
  diagnostic?: (event: UsgsDiagnostic) => void): Promise<UsgsCameraRecord[]> {
  const init = { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" } };
  const page = await fetchImpl(pageUrl, init);
  if (page.status === 403 || page.status === 404) {
    diagnostic?.({ stage: "page", url: pageUrl, status: page.status, reason: page.status === 403 ? "access_denied" : "not_found" });
    return [];
  }
  if (!page.ok) throw new Error(`USGS webcam page ${page.status}`);
  const discovered = parseUsgsVolcanoWebcams(await page.text(), pageUrl);
  if (!discovered.length) diagnostic?.({ stage: "parse", url: pageUrl, status: page.status, reason: "no_camera_codes" });
  const out: UsgsCameraRecord[] = [];
  for (const camera of discovered) {
    const detail = await fetchImpl(camera.detailUrl, init);
    if (!detail.ok) diagnostic?.({ stage: "detail", url: camera.detailUrl, status: detail.status, reason: "detail_http_error" });
    out.push(detail.ok ? parseUsgsCameraDetail(camera, await detail.text()) : camera);
  }
  return out;
}
