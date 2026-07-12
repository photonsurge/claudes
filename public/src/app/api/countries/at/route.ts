import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { pointInPolygon, type SimpleGeometry } from "@photonsurge/shared/geo/pointInPolygon";
import type { iCountryModel } from "@photonsurge/shared/db/country-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** Rough bbox area (deg²) — used to prefer the *smallest* country whose real
 *  boundary contains the point, so an enclave/overseas-territory point doesn't
 *  snap to the big country whose bbox merely spans it. */
function bboxArea(b: [number, number, number, number]): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

/** Drop the heavy boundary geometry before sending to the client — the on-air
 *  card only needs the enrichment (photo/blurb/capital) + bbox. */
function stripGeometry(c: iCountryModel): Omit<iCountryModel, "geometry"> {
  const { geometry: _geometry, ...rest } = c;
  return rest;
}

/**
 * GET /api/countries/at?lng=<>&lat=<>
 * The enriched Country doc whose real (simplified) boundary contains the point,
 * or `{ country: null }` when the point is over open ocean / outside every
 * country. Drives the round-up's per-stop "the place" card (CountryPanel) and
 * scopes its cities/hazards to the country the tour is currently parked on —
 * `countryContaining` (shared/director-countries) only covers the ~30 curated
 * spotlight catalog, whereas the round-up can land anywhere.
 *
 * Ray-casts against the same polygon mask the area-weather job uses; candidates
 * are bbox-prefiltered first so a point only tests the handful of countries
 * whose box spans it, and ties break to the smallest-area boundary.
 */
async function GET__impl(req: Request) {
  const url = new URL(req.url);
  const lng = Number(url.searchParams.get("lng"));
  const lat = Number(url.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return NextResponse.json({ error: "lng and lat are required" }, { status: 400, headers: NO_CACHE });
  }
  try {
    const db = await getAppDb();
    const countries = await db.countries.list();
    const hits = countries
      .filter(
        (c) =>
          c.bbox &&
          lng >= c.bbox[0] &&
          lng <= c.bbox[2] &&
          lat >= c.bbox[1] &&
          lat <= c.bbox[3] &&
          c.geometry &&
          pointInPolygon(lng, lat, c.geometry as SimpleGeometry),
      )
      .sort((a, b) => bboxArea(a.bbox) - bboxArea(b.bbox));
    const country = hits[0] ? stripGeometry(hits[0]) : null;
    return NextResponse.json({ country }, { status: 200, headers: NO_CACHE });
  } catch (error) {
    return NextResponse.json({ error: String(error), country: null }, { status: 502, headers: NO_CACHE });
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
