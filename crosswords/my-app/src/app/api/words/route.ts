import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toInt = (raw: string | null, fallback: number, min: number, max: number) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return Math.min(max, Math.max(min, v));
};

export const GET = async (req: Request) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const status = (url.searchParams.get("status") ?? "").trim();
    const sort = (url.searchParams.get("sort") ?? "updated_desc").trim();
    const approved = (url.searchParams.get("approved") ?? "").trim() === "1";
    const page = toInt(url.searchParams.get("page"), 1, 1, 1000000);
    const limit = toInt(url.searchParams.get("limit"), 200, 1, 1000);
    const skip = (page - 1) * limit;

    const baseMatch: Record<string, any> = {};
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      baseMatch.$or = [{ norm: rx }, { word: rx }, { "raw.importWord": rx }];
    }
    const match: Record<string, any> = { ...baseMatch };
    if (status) match["enrichment.status"] = status;
    if (approved) match["validation.decision"] = "accepted";

    const db = await getDb();
    const words = db.collection("words");
    const clues = db.collection("clues");
    const sortMap: Record<string, Record<string, 1 | -1>> = {
      updated_desc: { updatedAt: -1, _id: -1 },
      updated_asc: { updatedAt: 1, _id: 1 },
      word_asc: { norm: 1, _id: 1 },
      word_desc: { norm: -1, _id: -1 },
      length_asc: { length: 1, norm: 1, _id: 1 },
      length_desc: { length: -1, norm: 1, _id: -1 },
    };
    const sortSpec = sortMap[sort] ?? sortMap.updated_desc;

    const [total, items, statusBuckets, validationBuckets] = await Promise.all([
      words.countDocuments(match),
      words
        .find(match, {
          projection: {
            norm: 1,
            word: 1,
            length: 1,
            pos: 1,
            enrichment: 1,
            validation: 1,
            updatedAt: 1,
          },
        })
        .sort(sortSpec)
        .skip(skip)
        .limit(limit)
        .toArray(),
      words
        .aggregate<{ _id: string | null; count: number }>([
          { $match: baseMatch },
          { $group: { _id: "$enrichment.status", count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      words
        .aggregate<{ _id: string | null; count: number }>([
          { $match: match },
          { $group: { _id: "$validation.decision", count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
    ]);

    const clueCounts =
      items.length > 0
        ? await clues
            .aggregate<{ _id: unknown; count: number }>([
              { $match: { answerId: { $in: items.map((i) => i._id) } } },
              { $group: { _id: "$answerId", count: { $sum: 1 } } },
            ])
            .toArray()
        : [];

    const clueCountById = new Map(clueCounts.map((c) => [String(c._id), c.count]));
    const itemsWithMeta = items.map((item) => ({
      ...item,
      clueCount: clueCountById.get(String(item._id)) ?? 0,
    }));

    const statusTotals = Object.fromEntries(
      statusBuckets.map((b) => [b._id ?? "unknown", b.count])
    );
    const validationTotals = Object.fromEntries(
      validationBuckets.map((b) => [b._id ?? "unknown", b.count])
    );

    return NextResponse.json({
      ok: true,
      q,
      status,
      sort,
      approved,
      page,
      limit,
      total,
      statusTotals,
      validationTotals,
      items: itemsWithMeta,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Failed to load words" },
      { status: 500 }
    );
  }
};
