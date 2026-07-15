import { timeoutFetch } from "../../http";
import type { VolcanoMediaType } from "@photonsurge/shared/volcanoes/media";

export const IMO_EPOS_OPENAPI = "https://api.vedur.is/epos/openapi.json";
const GENERAL_PATH = "/volcano/general-information/eruption-images";
const MONITORING_PATH = "/volcano/monitoring-data/eruption-images";

export interface ImoEruptionImage {
  sourceMediaId?: string;
  volcanoName?: string;
  eruption?: string;
  title?: string;
  caption?: string;
  observedAt?: Date;
  imageUrl: string;
  sourceUrl: string;
  attribution: string;
  licence: string;
  reuseAllowed: boolean;
  type: VolcanoMediaType;
}

export function resolveImoEruptionImageOperations(oas: any, oasUrl = IMO_EPOS_OPENAPI): string[] {
  const advertised = String(oas?.servers?.[0]?.url ?? ".");
  // OAS permits relative server URLs (IMO currently publishes one). Resolve it
  // against the schema document before appending operation paths.
  const server = new URL(advertised, oasUrl).toString();
  return [MONITORING_PATH, GENERAL_PATH]
    .filter((path) => oas?.paths?.[path]?.get)
    .map((path) => new URL(path.replace(/^\//, ""), server.endsWith("/") ? server : `${server}/`).toString());
}

const first = (row: any, keys: string[]) => {
  for (const key of keys) if (row?.[key] != null && row[key] !== "") return row[key];
  return undefined;
};

const records = (value: any): any[] => Array.isArray(value) ? value
  : Array.isArray(value?.items) ? value.items
  : Array.isArray(value?.features) ? value.features.map((f: any) => ({ ...f.properties, geometry: f.geometry }))
  : Array.isArray(value?.data) ? value.data : [];

/** Tolerant normalizer driven by the fetched OAS operation rather than a frozen schema assumption. */
export function parseImoEruptionImages(value: unknown, sourceUrl: string): ImoEruptionImage[] {
  const out: ImoEruptionImage[] = [];
  for (const raw of records(value as any)) {
    const row = raw?.properties ? { ...raw.properties, ...raw } : raw;
    const image = first(row, ["image_url", "imageUrl", "url", "href", "download_url", "downloadUrl", "file"]);
    if (typeof image !== "string" || !/^https?:|^\//i.test(image)) continue;
    const dateValue = first(row, ["observed_at", "observedAt", "date", "datetime", "timestamp", "start_time"]);
    const observedAt = dateValue ? new Date(dateValue) : undefined;
    out.push({
      sourceMediaId: String(first(row, ["id", "image_id", "identifier", "uuid"]) ?? image),
      volcanoName: first(row, ["volcano", "volcano_name", "volcanoName", "name"]),
      eruption: first(row, ["eruption", "event", "eruption_name"]),
      title: first(row, ["title", "name"]),
      caption: first(row, ["caption", "description", "comment"]),
      observedAt: observedAt && !Number.isNaN(+observedAt) ? observedAt : undefined,
      imageUrl: new URL(image, sourceUrl).toString(),
      sourceUrl,
      attribution: String(first(row, ["credit", "attribution", "author", "agency"]) ?? "Icelandic Meteorological Office"),
      licence: "CC BY-SA 4.0",
      reuseAllowed: true,
      type: /thermal|infrared|\bIR\b/i.test(`${first(row, ["product", "type", "title"]) ?? ""}`) ? "IR" : "PHOTO",
    });
  }
  return out;
}

export async function fetchImoEruptionImages(fetchImpl: typeof fetch = timeoutFetch()): Promise<ImoEruptionImage[]> {
  const schemaRes = await fetchImpl(IMO_EPOS_OPENAPI);
  if (!schemaRes.ok) throw new Error(`IMO EPOS OpenAPI ${schemaRes.status}`);
  const operations = resolveImoEruptionImageOperations(await schemaRes.json());
  const out: ImoEruptionImage[] = [];
  for (const url of operations) {
    const res = await fetchImpl(url);
    if (res.ok) out.push(...parseImoEruptionImages(await res.json(), url));
  }
  return out;
}
