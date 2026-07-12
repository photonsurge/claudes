import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { normalizeGeocode, type NominatimHit } from "./normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/geocode?q= — proxy to the configured Nominatim-compatible service. */
async function GET__impl(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ error: "missing q" }, { status: 400 });
  }

  const base = process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org";
  const url = `${base.replace(/\/$/, "")}/search?format=json&limit=1&q=${encodeURIComponent(q)}`;

  let hits: NominatimHit[] = [];
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "LiveWeatherGlobe/1.0 (weather channel app)",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: "geocoder error" }, { status: 502 });
    }
    hits = (await res.json()) as NominatimHit[];
  } catch {
    return NextResponse.json({ error: "geocoder unreachable" }, { status: 502 });
  }

  const normalized = normalizeGeocode(hits[0]);
  if (!normalized) {
    return NextResponse.json({ result: null }, { status: 200 });
  }
  return NextResponse.json(normalized, { status: 200 });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
