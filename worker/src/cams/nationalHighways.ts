import type { CamSource, Cam } from "@photonsurge/shared/cams/types";
import { normaliseCam } from "@photonsurge/shared/cams/normalise";

/**
 * National Highways (UK motorway CCTV) adapter (spec §5, Phase 2).
 *
 * National Highways publishes its CCTV image feed through the DATEX II product
 * on their Azure API portal, which requires a FREE subscription key
 * (`Ocp-Apim-Subscription-Key`). The canonical feed is DATEX II **XML**; this
 * repo has no XML parser wired in, so this adapter is intentionally gated OFF
 * until both a key is provided AND `CAMS_NH_ENABLED=true`. `fetchCatalogue`
 * expects a JSON representation (some products expose one via `Accept`); if the
 * feed comes back as XML it throws a clear error rather than silently ingesting
 * nothing — add a parser step (e.g. fast-xml-parser) before flipping it on.
 *
 * The mapping (`mapNationalHighwaysCamera`) is pure and unit-tested so the
 * canonical shape is locked in; only the transport/parse layer needs finishing.
 */

const FEED =
  process.env.NH_CCTV_URL || "https://api.data.nationalhighways.co.uk/cctv/v1/cameras";
const POLL_SEC = Number(process.env.NH_INGEST_SEC || 15 * 60);

/** A single already-parsed National Highways camera record (JSON shape). */
export interface NhCamera {
  id?: string;
  reference?: string;
  name?: string;
  title?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  imageUrl?: string;
  status?: string;
  available?: boolean;
}

/** Map one National Highways camera → canonical Cam (pure). */
export function mapNationalHighwaysCamera(c: NhCamera): Cam | null {
  const providerId = c.id || c.reference;
  const title = c.name || c.title;
  const lat = typeof c.latitude === "number" ? c.latitude : c.lat;
  const lng = typeof c.longitude === "number" ? c.longitude : c.lng;
  if (!providerId || !title || typeof lat !== "number" || typeof lng !== "number") return null;

  const status =
    c.available === true || c.status === "active"
      ? "active"
      : c.available === false || c.status === "inactive"
        ? "inactive"
        : "unknown";

  return normaliseCam({
    camId: `nh:${providerId}`,
    provider: "national_highways",
    title,
    lat,
    lng,
    status,
    place: "United Kingdom",
    country: "GB",
    imageUrl: c.imageUrl,
    tags: ["traffic", "motorway", "uk"],
    attribution: {
      provider: "National Highways",
      requiredText: "Contains National Highways data © Crown copyright and database right",
      linkUrl: "https://nationalhighways.co.uk",
    },
  });
}

export const nationalHighwaysSource: CamSource = {
  id: "national_highways",
  provider: "national_highways",
  region: "UK motorways (National Highways)",
  pollIntervalSec: POLL_SEC,
  // Off unless explicitly enabled AND a subscription key is present.
  enabled:
    process.env.CAMS_NH_ENABLED === "true" &&
    Boolean(process.env.NATIONAL_HIGHWAYS_API_KEY),

  async fetchCatalogue(): Promise<Cam[]> {
    const key = process.env.NATIONAL_HIGHWAYS_API_KEY;
    if (!key) throw new Error("NATIONAL_HIGHWAYS_API_KEY is not set");

    const res = await fetch(FEED, {
      headers: { "Ocp-Apim-Subscription-Key": key, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`National Highways CCTV ${res.status} ${res.statusText}`);

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      throw new Error(
        `National Highways feed returned "${contentType}" (expected JSON). ` +
          `The DATEX II feed is XML — add an XML→JSON parse step before enabling.`,
      );
    }

    const body = (await res.json()) as unknown;
    const list: NhCamera[] = Array.isArray(body)
      ? (body as NhCamera[])
      : ((body as { cameras?: NhCamera[] })?.cameras ?? []);
    return list.map(mapNationalHighwaysCamera).filter((c): c is Cam => c !== null);
  },
};
