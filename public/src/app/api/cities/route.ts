import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { validateCity } from "../../../lib/cities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/cities — cities for overlays, sorted by population desc.
 * Query params (all optional): `limit` (default 300, max 8000), `minPop`,
 * `capital=1`. Defaults keep the globe readable while the DB holds ~7k cities.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 300, 1), 8000);
  const minPop = Math.max(Number(sp.get("minPop")) || 0, 0);
  const capital = sp.get("capital");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {};
  if (minPop > 0) query.population = { $gte: minPop };
  if (capital === "1" || capital === "true") query.isCapital = true;

  const db = await getAppDb();
  const res = await db.cities.getAll(query, { sort: { population: -1 }, limit });
  return NextResponse.json({ cities: res?.data ?? [] }, { status: 200, headers: NO_CACHE });
}

/** POST /api/cities — create a city after validation. */
export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body → validation fails below */
  }

  const result = validateCity(body as Record<string, unknown>);
  if (!result.ok || !result.value) {
    return NextResponse.json({ errors: result.errors }, { status: 400 });
  }

  const db = await getAppDb();
  const created = await db.cities.create(result.value);
  if (!created?.success) {
    return NextResponse.json(
      { error: "create failed", errors: created?.errors },
      { status: 500 },
    );
  }
  return NextResponse.json({ city: created.data }, { status: 201, headers: NO_CACHE });
}
