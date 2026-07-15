import { timeoutFetch, mapPool } from "../../http";
import type { VolcanoMediaType } from "@photonsurge/shared/volcanoes/media";
export const VOLCAT_LIST_URL = "https://volcano.ssec.wisc.edu/imagery/get_list/json/";
export interface VolcatImage { sectorId: string; satellite?: string; instrument?: string; product?: string; observedAt?: Date; imageUrl: string; sourceUrl: string; type: VolcanoMediaType }

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const urlFor = (params: Record<string, string>) => VOLCAT_LIST_URL + Object.entries(params).map(([k, v]) => `${k}:${encodeURIComponent(v)}`).join("::");
const classify = (product = ""): VolcanoMediaType => /thermal|hotspot/i.test(product) ? "THERMAL" : "SATELLITE";
/** Sectors walked at once, and products within each — kept small on purpose. */
const SECTOR_CONCURRENCY = 4;
const PRODUCT_CONCURRENCY = 3;

export async function fetchVolcatImages(volcanoNames: string[], fetchImpl: typeof fetch = timeoutFetch()): Promise<VolcatImage[]> {
  const base = { sector: "null", instr: "null", sat: "all", image_type: "null", endtime: "null", daterange: "null" };
  const rootUrl = urlFor(base); const rootRes = await fetchImpl(rootUrl); if (!rootRes.ok) return [];
  const root: any = await rootRes.json(); const names: string[] = root?.sector?.name ?? [];
  const wanted = new Set(volcanoNames.map(normalize));
  const sectors = names.filter((sector) => [...wanted].some((name) => normalize(sector).includes(name) || name.includes(normalize(sector))));
  // Sector menus, then each sector's products — both pooled. Walked serially this
  // is sectors × products round trips end to end, so a busy day (many active
  // volcanoes matching many sectors) set the runtime of the whole job. Modest
  // limits: this is a university server, not a CDN.
  const nested = await mapPool(sectors, SECTOR_CONCURRENCY, async (sector) => {
    let products: string[] = [];
    try {
      const menuRes = await fetchImpl(urlFor({ ...base, sector, instr: "all" }));
      if (!menuRes.ok) return [];
      products = ((await menuRes.json()) as any)?.image_type ?? [];
    } catch {
      return []; // one bad sector menu must not abandon the rest
    }
    const images = await mapPool(products, PRODUCT_CONCURRENCY, async (product) => {
      const sourceUrl = urlFor({ sector, instr: "all", sat: "all", image_type: product, endtime: "latest", daterange: "60" });
      try {
        const res = await fetchImpl(sourceUrl); if (!res.ok) return null;
        const data: any = await res.json();
        const frames: any[] = data?.endtime ?? []; const latest = frames[frames.length - 1];
        if (!latest?.filename) return null;
        const observedAt = latest.datetime ? new Date(String(latest.datetime).replace("_", "T").replace(/-/g, (m: string, offset: number) => offset > 9 ? ":" : m) + "Z") : undefined;
        return { sectorId: sector, satellite: latest.sat ?? latest.satellite, instrument: latest.instr,
          product, observedAt: observedAt && !Number.isNaN(+observedAt) ? observedAt : undefined,
          imageUrl: new URL(latest.filename, "https://volcano.ssec.wisc.edu/").toString(), sourceUrl, type: classify(product) } as VolcatImage;
      } catch {
        return null;
      }
    });
    return images.filter((image): image is VolcatImage => image !== null);
  });
  return nested.flat();
}
