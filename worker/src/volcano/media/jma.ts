import { timeoutFetch } from "../../http";
import { cameraModeFromText, type VolcanoCameraMode } from "@photonsurge/shared/volcanoes/media";
export const JMA_VOLCAMS = "https://www.data.jma.go.jp/vois/data/obs/volcam/volcam.php";
export interface JmaCamera { sourceCameraId: string; volcanoName: string; name: string; mode: VolcanoCameraMode; imageUrl: string; detailUrl: string }
const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
export function discoverJmaCameraPages(html: string) { const seen = new Set<string>(); const out: Array<{ id: string; name: string; detailUrl: string }> = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["'][^"']*volcam\.php\?VC=\d+[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)) { const href = attr(m[0], "href"); const id = /[?&]VC=(\d+)/i.exec(href ?? "")?.[1];
    if (!href || !id || seen.has(id)) continue; seen.add(id); out.push({ id, name: plain(m[0]) || `JMA camera ${id}`, detailUrl: new URL(href.replace(/&amp;/g, "&"), JMA_VOLCAMS).toString() }); } return out; }
export function parseJmaCameraPage(html: string, camera: { id: string; name: string; detailUrl: string }): JmaCamera | null { const images = [...html.matchAll(/<img\b[^>]*(?:src|data-src)\s*=\s*["'][^"']+["'][^>]*>/gi)].map((m) => attr(m[0], "src") ?? attr(m[0], "data-src")).filter((v): v is string => Boolean(v));
  const image = images.find((url) => /\/vois\/data\/obs\/camera\/.*\.(?:jpe?g|png)(?:[?#]|$)/i.test(url)); if (!image) return null;
  const volcanoName = camera.name.replace(/[（(].*?[）)]/g, " ").replace(/(?:監視カメラ|camera|ライブ|live)/gi, " ").trim();
  return { sourceCameraId: camera.id, volcanoName, name: camera.name, mode: cameraModeFromText(camera.name), imageUrl: new URL(image, camera.detailUrl).toString(), detailUrl: camera.detailUrl }; }
export async function fetchJmaCameras(fetchImpl: typeof fetch = timeoutFetch()): Promise<JmaCamera[]> { const root = await fetchImpl(JMA_VOLCAMS); if (!root.ok) throw new Error(`JMA registry ${root.status}`); const pages = discoverJmaCameraPages(await root.text()); const out: JmaCamera[] = [];
  for (let i = 0; i < pages.length; i += 8) await Promise.all(pages.slice(i, i + 8).map(async (camera) => { const res = await fetchImpl(camera.detailUrl); if (!res.ok) return; const parsed = parseJmaCameraPage(await res.text(), camera); if (parsed) out.push(parsed); })); return out; }
