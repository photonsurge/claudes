/**
 * GeoNet volcano camera catalogue — official monitoring cameras (Ruapehu,
 * Ngauruhoe/Tongariro, Whakaari, Taranaki…), each with a latest-image URL. These
 * are first-class monitoring instruments, not tourism webcams.
 *
 * GOTCHA: GeoNet's `geometry.coordinates` are [lat, lng] (reversed from GeoJSON).
 * The image URLs are relative to the cameras base; a camera can serve MULTIPLE
 * volcanoes (`volcano-id` is an array of slugs). Undocumented endpoint — tolerant
 * parsing. Ids are GeoNet slugs, so a caller crosswalks them onto `gvp:<vnum>`.
 */
export const GEONET_CAMS_URL =
  process.env.GEONET_CAMS_URL || "https://images.geonet.org.nz/volcano/cameras/all.json";

const GEONET_CAM_BASE = "https://images.geonet.org.nz/volcano/cameras/";

export interface GeonetCam {
  cameraId: string;
  title: string;
  lat: number;
  lng: number;
  azimuthDeg?: number;
  /** GeoNet volcano slug(s) this camera views. */
  volcanoSlugs: string[];
  /** Full URL of the latest large still. */
  imageUrl: string;
  thumbUrl?: string;
  /** GeoNet's human capture timestamp (e.g. " 4:10 pm (NZST) 13 Jul 2026"). */
  timestampText?: string;
}

/** Pure parse of the GeoNet camera catalogue (no HTTP). */
export function parseGeonetCams(json: unknown): GeonetCam[] {
  const groups: any[] = Array.isArray(json) ? json : [];
  const out: GeonetCam[] = [];
  const seen = new Set<string>();
  for (const grp of groups) {
    const features: any[] = Array.isArray(grp?.features) ? grp.features : [];
    for (const f of features) {
      const cameraId = String(f?.id ?? "").trim();
      const coords = f?.geometry?.coordinates;
      // GeoNet uses [lat, lng] — the reverse of standard GeoJSON.
      const lat = Number(coords?.[0]);
      const lng = Number(coords?.[1]);
      if (!cameraId || seen.has(cameraId) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const p = f?.properties ?? {};
      const large = String(p?.["latest-image-large"] ?? "").trim();
      if (!large) continue;
      seen.add(cameraId);
      out.push({
        cameraId,
        title: String(p?.title ?? "").trim() || cameraId,
        lat,
        lng,
        azimuthDeg: Number.isFinite(Number(p?.azimuth)) ? Number(p.azimuth) : undefined,
        volcanoSlugs: Array.isArray(f?.["volcano-id"]) ? f["volcano-id"].map((s: any) => String(s).trim()).filter(Boolean) : [],
        imageUrl: GEONET_CAM_BASE + large,
        thumbUrl: p?.["latest-image-thumb"] ? GEONET_CAM_BASE + String(p["latest-image-thumb"]) : undefined,
        timestampText: typeof p?.["latest-timestamp"] === "string" ? p["latest-timestamp"].trim() : undefined,
      });
    }
  }
  return out;
}

export async function fetchGeonetCams(fetchImpl: typeof fetch = fetch): Promise<GeonetCam[]> {
  const res = await fetchImpl(GEONET_CAMS_URL);
  if (!res.ok) throw new Error(`geonet cams ${res.status}`);
  return parseGeonetCams(await res.json());
}
