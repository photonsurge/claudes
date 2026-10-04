import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MYSTERY_COLLECTION = process.env.MYSTERY_COLL || "murder_mysteries";

const toInt = (raw: string | null, fallback: number, min: number, max: number) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return Math.min(max, Math.max(min, v));
};

const toDateIso = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
};

const countOptions = (root: unknown, key: "characters" | "locations") => {
  if (!root || typeof root !== "object" || Array.isArray(root)) return 0;
  const rows = (root as Record<string, unknown>)[key];
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((acc, row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return acc;
    const options = (row as Record<string, unknown>).options;
    return acc + (Array.isArray(options) ? options.length : 0);
  }, 0);
};

export const GET = async (req: Request) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const sort = (url.searchParams.get("sort") ?? "updated_desc").trim();
    const page = toInt(url.searchParams.get("page"), 1, 1, 1_000_000);
    const limit = toInt(url.searchParams.get("limit"), 20, 1, 100);
    const skip = (page - 1) * limit;

    const match: Record<string, unknown> = { kind: "murder_mystery" };
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      match.$or = [{ title: rx }, { "outline.logline": rx }, { story: rx }];
    }

    const db = await getDb();
    const mysteries = db.collection(MYSTERY_COLLECTION);
    const sortMap: Record<string, Record<string, 1 | -1>> = {
      updated_desc: { updatedAt: -1, _id: -1 },
      updated_asc: { updatedAt: 1, _id: 1 },
      created_desc: { createdAt: -1, _id: -1 },
      created_asc: { createdAt: 1, _id: 1 },
      title_asc: { title: 1, _id: 1 },
      title_desc: { title: -1, _id: -1 },
    };
    const sortSpec = sortMap[sort] ?? sortMap.updated_desc;

    const [total, itemsRaw] = await Promise.all([
      mysteries.countDocuments(match),
      mysteries
        .find(match, {
          projection: {
            title: 1,
            outline: 1,
            createdAt: 1,
            updatedAt: 1,
            kind: 1,
            story: 1,
            chapters: 1,
            characterVisuals: 1,
            locationVisuals: 1,
          },
        })
        .sort(sortSpec)
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);

    const items = itemsRaw.map((item) => {
      const story = typeof item.story === "string" ? item.story : "";
      const outline = item.outline as { logline?: unknown } | undefined;
      const logline = typeof outline?.logline === "string" ? outline.logline : "";

      return {
        _id: String(item._id),
        kind: item.kind ?? null,
        title: typeof item.title === "string" ? item.title : "Untitled Mystery",
        logline,
        storyPreview: story.slice(0, 260),
        chapterCount: Array.isArray(item.chapters) ? item.chapters.length : 0,
        characterVisualCount: countOptions(item.characterVisuals, "characters"),
        locationVisualCount: countOptions(item.locationVisuals, "locations"),
        createdAt: toDateIso(item.createdAt),
        updatedAt: toDateIso(item.updatedAt),
      };
    });

    return NextResponse.json({
      ok: true,
      q,
      sort,
      page,
      limit,
      total,
      items,
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : "Failed to load mysteries";
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
};
