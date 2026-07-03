import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { validateCity } from "../../../lib/cities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const MAX_PAGE_SIZE = 250;
const SORT_FIELDS = new Set(["name", "country", "lat", "lng", "population", "isCapital", "rank", "wikiFetchedAt", "updated"]);

/**
 * GET /api/cities — cities for overlays, sorted by population desc.
 * Query params (all optional): `limit` (default 300, max 8000), `minPop`,
 * `capital=1`. Defaults keep the globe readable while the DB holds ~7k cities.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const paged = sp.has("page") || sp.has("pageSize") || sp.has("sort") || sp.has("q");
  const pageSize = paged
    ? Math.floor(Math.min(Math.max(Number(sp.get("pageSize")) || 25, 1), MAX_PAGE_SIZE))
    : Math.min(Math.max(Number(sp.get("limit")) || 300, 1), 8000);
  const page = paged ? Math.max(Math.floor(Number(sp.get("page")) || 1), 1) : 1;
  const skip = paged ? (page - 1) * pageSize : 0;
  const minPop = Math.max(Number(sp.get("minPop")) || 0, 0);
  const capital = sp.get("capital");
  const q = sp.get("q")?.trim();
  const sortRaw = sp.get("sort") || "population";
  const sortField = SORT_FIELDS.has(sortRaw) ? sortRaw : "population";
  const direction: 1 | -1 = sp.get("direction") === "asc" ? 1 : -1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {};
  if (minPop > 0) query.population = { $gte: minPop };
  if (capital === "1" || capital === "true") query.isCapital = true;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ name: rx }, { country: rx }, { cc: rx }, { region: rx }];
  }

  const db = await getAppDb();
  const sort: Record<string, 1 | -1> = paged ? { [sortField]: direction } : { population: -1 };
  if (paged && sortField !== "name") sort.name = 1;
  const [res, total] = await Promise.all([
    db.cities.getAll(query, { sort, limit: pageSize, skip }),
    paged ? db.cities.model.countDocuments(query).exec() : Promise.resolve(0),
  ]);
  const cities = res?.data ?? [];
  return NextResponse.json(
    {
      cities,
      count: cities.length,
      total: paged ? total : cities.length,
      page,
      pageSize,
      pageCount: paged ? Math.ceil(total / pageSize) : cities.length ? 1 : 0,
      sort: sortField,
      direction: direction === 1 ? "asc" : "desc",
    },
    { status: 200, headers: NO_CACHE },
  );
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
