import type { VolcanoMediaType } from "@photonsurge/shared/volcanoes/media";

export const NASA_IMAGES_SEARCH = "https://images-api.nasa.gov/search?q=volcano%20eruption&media_type=image&page_size=100";

export interface NasaVolcanoImage {
  sourceMediaId: string;
  title: string;
  caption?: string;
  imageUrl: string;
  sourceUrl: string;
  observedAt?: Date;
  volcanoName?: string;
  type: VolcanoMediaType;
}

export function parseNasaVolcanoImages(payload: unknown, volcanoNames: string[]): NasaVolcanoImage[] {
  const items = (payload as { collection?: { items?: unknown[] } })?.collection?.items ?? [];
  return items.flatMap((raw) => {
    const item = raw as { href?: string; data?: Array<Record<string, unknown>>; links?: Array<Record<string, unknown>> };
    const data = item.data?.[0];
    const image = item.links?.find((link) => link.render === "image" && typeof link.href === "string");
    if (!data || !image || typeof data.nasa_id !== "string" || typeof data.title !== "string") return [];
    const haystack = `${data.title} ${String(data.description ?? "")} ${String(data.location ?? "")}`.toLowerCase();
    const volcanoName = volcanoNames.find((name) => {
      const key = name.toLowerCase().replace(/\b(?:mount|mt\.?|volcano)\b/g, "").trim();
      return key.length >= 4 && haystack.includes(key);
    });
    if (!volcanoName) return [];
    const date = typeof data.date_created === "string" ? new Date(data.date_created) : undefined;
    return [{ sourceMediaId: data.nasa_id, title: data.title, caption: typeof data.description === "string" ? data.description : undefined,
      imageUrl: String(image.href), sourceUrl: item.href ?? `https://images.nasa.gov/details/${encodeURIComponent(data.nasa_id)}`,
      observedAt: date && !Number.isNaN(date.valueOf()) ? date : undefined, volcanoName, type: "PHOTO" as const }];
  });
}

export async function fetchNasaVolcanoImages(volcanoNames: string[], fetchImpl: typeof fetch = fetch): Promise<NasaVolcanoImage[]> {
  const response = await fetchImpl(NASA_IMAGES_SEARCH, { headers: { Accept: "application/json", "User-Agent": "WeatherChannel volcano media registry" } });
  if (!response.ok) return [];
  return parseNasaVolcanoImages(await response.json(), volcanoNames);
}
