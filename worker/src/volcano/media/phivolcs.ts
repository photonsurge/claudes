import { timeoutFetch } from "../../http";
import { createHash } from "node:crypto";

export const PHIVOLCS_INSTRUMENTS = "https://wovodat.phivolcs.dost.gov.ph/monitor/instruments";
export interface PhivolcsVolcano { code: string; name: string }
export interface PhivolcsCamera { sourceCameraId: string; volcanoCode: string; volcanoName: string; name: string; imageUrl: string; detailUrl: string; observedAt?: string }
export interface PhivolcsDiagnostic { stage: "root" | "root_parse" | "volcano" | "volcano_parse"; url: string; status?: number; reason: string; volcano?: string }

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();

export function parsePhivolcsVolcanoes(html: string): PhivolcsVolcano[] {
  const out: PhivolcsVolcano[] = [];
  for (const m of html.matchAll(/<option\b[^>]*value=["'][^"']+["'][^>]*>[\s\S]*?<\/option>/gi)) {
    const code = attr(m[0], "value")?.trim(); const name = text(m[0]);
    if (code && name && !/select/i.test(name)) out.push({ code, name });
  }
  return out;
}

export function parsePhivolcsCameras(html: string, volcano: PhivolcsVolcano, detailUrl: string): PhivolcsCamera[] {
  const out: PhivolcsCamera[] = [];
  for (const m of html.matchAll(/<img\b[^>]*(?:src|data-src)=["'][^"']+["'][^>]*>/gi)) {
    const src = attr(m[0], "src") ?? attr(m[0], "data-src");
    if (!src || /logo|icon|avatar/i.test(src)) continue;
    const imageUrl = new URL(src, detailUrl).toString();
    const label = `${attr(m[0], "alt") ?? ""} ${attr(m[0], "title") ?? ""}`.trim() || `${volcano.name} camera`;
    out.push({ sourceCameraId: createHash("sha1").update(imageUrl.split("?")[0]).digest("hex").slice(0, 16),
      volcanoCode: volcano.code, volcanoName: volcano.name, name: label, imageUrl, detailUrl,
      observedAt: /(20\d{2}[-/]\d{2}[-/]\d{2}[^"'<]{0,20})/.exec(m[0])?.[1]?.trim() });
  }
  return out;
}

export async function fetchPhivolcsCameras(fetchImpl: typeof fetch = timeoutFetch(),
  diagnostic?: (event: PhivolcsDiagnostic) => void): Promise<PhivolcsCamera[]> {
  let root: Response;
  try { root = await fetchImpl(PHIVOLCS_INSTRUMENTS); }
  catch (err) { diagnostic?.({ stage: "root", url: PHIVOLCS_INSTRUMENTS, reason: err instanceof Error ? err.message : String(err) }); throw err; }
  if (!root.ok) throw new Error(`PHIVOLCS instruments ${root.status}`);
  const volcanoes = parsePhivolcsVolcanoes(await root.text());
  if (!volcanoes.length) diagnostic?.({ stage: "root_parse", url: PHIVOLCS_INSTRUMENTS, status: root.status, reason: "no_volcano_options" });
  const out: PhivolcsCamera[] = [];
  for (const volcano of volcanoes) {
    const url = `${PHIVOLCS_INSTRUMENTS}?volcano=${encodeURIComponent(volcano.code)}`;
    const res = await fetchImpl(url);
    if (!res.ok) { diagnostic?.({ stage: "volcano", url, status: res.status, reason: "http_error", volcano: volcano.name }); continue; }
    const cameras = parsePhivolcsCameras(await res.text(), volcano, url);
    if (!cameras.length) diagnostic?.({ stage: "volcano_parse", url, status: res.status, reason: "no_camera_images", volcano: volcano.name });
    out.push(...cameras);
  }
  return out;
}
