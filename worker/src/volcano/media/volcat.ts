import type { VolcanoMediaType } from "@photonsurge/shared/volcanoes/media";
export const VOLCAT_LIST_URL = "https://volcano.ssec.wisc.edu/imagery/get_list/json/";
export interface VolcatImage { sectorId: string; satellite?: string; instrument?: string; product?: string; observedAt?: Date; imageUrl: string; sourceUrl: string; type: VolcanoMediaType }

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const urlFor = (params: Record<string, string>) => VOLCAT_LIST_URL + Object.entries(params).map(([k, v]) => `${k}:${encodeURIComponent(v)}`).join("::");
const classify = (product = ""): VolcanoMediaType => /thermal|hotspot/i.test(product) ? "THERMAL" : "SATELLITE";

export async function fetchVolcatImages(volcanoNames: string[], fetchImpl: typeof fetch = fetch): Promise<VolcatImage[]> {
  const base = { sector: "null", instr: "null", sat: "all", image_type: "null", endtime: "null", daterange: "null" };
  const rootUrl = urlFor(base); const rootRes = await fetchImpl(rootUrl); if (!rootRes.ok) return [];
  const root: any = await rootRes.json(); const names: string[] = root?.sector?.name ?? [];
  const wanted = new Set(volcanoNames.map(normalize));
  const sectors = names.filter((sector) => [...wanted].some((name) => normalize(sector).includes(name) || name.includes(normalize(sector))));
  const out: VolcatImage[] = [];
  for (const sector of sectors) {
    const menuUrl = urlFor({ ...base, sector, instr: "all" }); const menuRes = await fetchImpl(menuUrl); if (!menuRes.ok) continue;
    const menu: any = await menuRes.json(); const products: string[] = menu?.image_type ?? [];
    for (const product of products) {
      const sourceUrl = urlFor({ sector, instr: "all", sat: "all", image_type: product, endtime: "latest", daterange: "60" });
      const res = await fetchImpl(sourceUrl); if (!res.ok) continue; const data: any = await res.json();
      const frames: any[] = data?.endtime ?? []; const latest = frames[frames.length - 1];
      if (!latest?.filename) continue;
      const observedAt = latest.datetime ? new Date(String(latest.datetime).replace("_", "T").replace(/-/g, (m: string, offset: number) => offset > 9 ? ":" : m) + "Z") : undefined;
      out.push({ sectorId: sector, satellite: latest.sat ?? latest.satellite, instrument: latest.instr,
        product, observedAt: observedAt && !Number.isNaN(+observedAt) ? observedAt : undefined,
        imageUrl: new URL(latest.filename, "https://volcano.ssec.wisc.edu/").toString(), sourceUrl, type: classify(product) });
    }
  }
  return out;
}
