import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getDb } from "@photonsurge/shared/utill/mongoose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

interface CollectionSummary {
  name: string;
  count: number;
  avgObjSize: number;
  dataSize: number;
  storageSize: number;
  indexSize: number;
  indexCount: number;
  totalSize: number;
}

/**
 * GET /api/admin/db — Mongo database + per-collection size/doc-count summary
 * for the "Database" admin page. Reads `$collStats` off every collection in
 * one aggregation rather than N `collStats` commands.
 */
async function GET__impl() {
  const conn = await getDb();
  const db = conn.db;
  if (!db) {
    return NextResponse.json({ error: "mongo not connected" }, { status: 503, headers: NO_CACHE });
  }

  const [dbStats, collInfos] = await Promise.all([db.stats(), db.listCollections().toArray()]);

  const collections: CollectionSummary[] = await Promise.all(
    collInfos
      .filter((c) => c.type === "collection")
      .map(async (c) => {
        const [stats] = await db
          .collection(c.name)
          .aggregate([{ $collStats: { storageStats: {} } }])
          .toArray();
        const s = stats?.storageStats ?? {};
        const dataSize = s.size ?? 0;
        const storageSize = s.storageSize ?? 0;
        const indexSize = s.totalIndexSize ?? 0;
        return {
          name: c.name,
          count: s.count ?? 0,
          avgObjSize: s.avgObjSize ?? 0,
          dataSize,
          storageSize,
          indexSize,
          indexCount: s.nindexes ?? 0,
          totalSize: storageSize + indexSize,
        };
      }),
  );

  collections.sort((a, b) => b.totalSize - a.totalSize);

  return NextResponse.json(
    {
      db: db.databaseName,
      dbStats: {
        collections: dbStats.collections ?? collections.length,
        objects: dbStats.objects ?? 0,
        dataSize: dbStats.dataSize ?? 0,
        storageSize: dbStats.storageSize ?? 0,
        indexSize: dbStats.indexSize ?? 0,
        totalSize: (dbStats.storageSize ?? 0) + (dbStats.indexSize ?? 0),
      },
      collections,
      at: new Date().toISOString(),
    },
    { status: 200, headers: NO_CACHE },
  );
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
