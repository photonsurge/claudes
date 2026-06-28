import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { validateCity } from "../../../lib/cities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** GET /api/cities — all cities, sorted by population desc (nulls last). */
export async function GET() {
  const db = await getAppDb();
  const res = await db.cities.getAll();
  const cities = (res?.data ?? []).slice().sort((a, b) => {
    const pa = a.population ?? -1;
    const pb = b.population ?? -1;
    return pb - pa;
  });
  return NextResponse.json({ cities }, { status: 200, headers: NO_CACHE });
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
