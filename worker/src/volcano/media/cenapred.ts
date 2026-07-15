import { timeoutFetch } from "../../http";
import type { VolcanoCameraMode } from "@photonsurge/shared/volcanoes/media";
export const CENAPRED_POPO = "https://www.cenapred.unam.mx/reportesVolcanesMX/";
export interface CenapredCamera { sourceCameraId: string; volcanoName: string; name: string; mode: VolcanoCameraMode; imageUrl: string; detailUrl: string }
const DEFINITIONS = [["popo-altzomoni", "Altzomoni", /webcamsaltzomoni/i], ["popo-tlamacas", "Tlamacas", /webcamstlamacas/i], ["popo-tianguismanalco", "Tianguismanalco", /webcamstianguis/i]] as const;
export function parseCenapredCameras(html: string): CenapredCamera[] { const urls = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  return DEFINITIONS.flatMap(([id, site, pattern]) => { const url = urls.find((candidate) => pattern.test(candidate) && /\.(?:jpe?g|png)(?:[?#]|$)/i.test(candidate)); return url ? [{ sourceCameraId: id, volcanoName: "Popocatepetl", name: `Popocatépetl · ${site}`, mode: "LOW_LIGHT" as const, imageUrl: new URL(url, CENAPRED_POPO).toString(), detailUrl: CENAPRED_POPO }] : []; }); }
export async function fetchCenapredCameras(fetchImpl: typeof fetch = timeoutFetch()) { const res = await fetchImpl(CENAPRED_POPO); if (!res.ok) throw new Error(`CENAPRED report ${res.status}`); return parseCenapredCameras(await res.text()); }
