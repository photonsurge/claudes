import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { cityGeoWithinBox } from "@photonsurge/shared/db/city-model";
import { validateCity } from "../../../lib/cities";
import { withCache, FEED_TTL_SEC } from "../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const MAX_PAGE_SIZE = 250;
const SORT_FIELDS = new Set(["name", "country", "lat", "lng", "population", "isCapital", "rank", "wikiFetchedAt", "updated"]);

/**
 * GET /api/cities — cities for overlays, sorted by population desc.
 * Query params (all optional): `limit` (max 20000, default 300), `minPop`,
 * `capital=1`, `bbox=west,south,east,north`.
 *
 * The globe never holds every city at once — that's thousands of always-on
 * dots and DOM name labels, which tanks frame rate. Instead: a bounded default
 * (300, the world's biggest/capital cities) covers the whole-globe view, and a
 * `bbox` query — scoped to whatever region the camera is currently framing —
 * layers in the extra local detail a country/city spotlight needs.
 */
async function GET__impl(req: Request) {
  const sp = new URL(req.url).searchParams;
  // Canonical (param-sorted) key so the same params in any order reuse one entry.
  // Cities only change on an admin reseed/enrich, so a short TTL is safely fresh
  // and collapses the whole-globe default set (limit=300, which every viewer
  // polls) plus its big serialize onto one Redis read. Fail-open.
  const canon = new URLSearchParams(sp);
  canon.sort();
  const { value, hit } = await withCache(`feed:v1:cities:${canon.toString()}`, FEED_TTL_SEC, () =>
    buildCities(sp),
  );
  return NextResponse.json(value, {
    status: 200,
    headers: { ...NO_CACHE, "X-Cache": hit ? "hit" : "miss" },
  });
}

async function buildCities(sp: URLSearchParams) {
  const paged = sp.has("page") || sp.has("pageSize") || sp.has("sort") || sp.has("q");
  const hasBbox = sp.has("bbox");
  const pageSize = paged
    ? Math.floor(Math.min(Math.max(Number(sp.get("pageSize")) || 25, 1), MAX_PAGE_SIZE))
    : Math.min(Math.max(Number(sp.get("limit")) || (hasBbox ? 2000 : 300), 1), 20000);
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
  const cc = sp.get("cc")?.trim().toLowerCase();
  if (cc) query.cc = { $in: [cc, cc.toUpperCase()] };
  if (minPop > 0) query.population = { $gte: minPop };
  if (capital === "1" || capital === "true") query.isCapital = true;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ name: rx }, { country: rx }, { cc: rx }, { region: rx }];
  }
  if (hasBbox) {
    const parts = (sp.get("bbox") ?? "").split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [w, s, e, n] = parts;
      // 2dsphere box on `loc` (antimeridian-safe, no population-index walk).
      // On its own field, so it composes with the text-search `$or` above.
      query.loc = cityGeoWithinBox(w, s, e, n);
    }
  }

  const db = await getAppDb();
  const sort: Record<string, 1 | -1> = paged ? { [sortField]: direction } : { population: -1 };
  if (paged && sortField !== "name") sort.name = 1;
  // A bbox query is bounded by the box's area, so the 2dsphere `loc` index is
  // always the right access path — force it. Left to the planner, a sparse/
  // low-population box instead gets the `population: -1` walk, which examines
  // hundreds of docs to fill the limit and, worse, replans on every differently-
  // sized box (all the cost is planningTimeMicros, not the scan). See city-model.
  const hint = hasBbox ? "city_geo_ix" : undefined;
  const [res, total] = await Promise.all([
    db.cities.getAll(query, { sort, limit: pageSize, skip, hint }),
    paged
      ? db.cities.model.countDocuments(query, hint ? { hint } : undefined).exec()
      : Promise.resolve(0),
  ]);
  const cities = res?.data ?? [];
  return {
    cities,
    count: cities.length,
    total: paged ? total : cities.length,
    page,
    pageSize,
    pageCount: paged ? Math.ceil(total / pageSize) : cities.length ? 1 : 0,
    sort: sortField,
    direction: direction === 1 ? "asc" : "desc",
  };
}

/** POST /api/cities — create a city after validation. */
async function POST__impl(req: Request) {
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

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
