import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
async function main() {
  const db = await getAppDb();
  const rows = await db.conn.collection("logs")
    .find({ tag: "job:alert-blobs" })
    .sort({ _id: -1 }).limit(4).toArray();
  for (const r of rows) {
    console.log("---", new Date(r.createdAt ?? r.ts ?? 0).toISOString(), r.message?.slice(0, 70));
    const d: any = r.data ?? r.meta ?? {};
    console.log("    keys:", Object.keys(d).join(","));
    console.log("    sliverHolesDropped:", d.sliverHolesDropped, "| blobs:", d.blobs, "| unionFailures:", d.unionFailures);
  }
  process.exit(0);
}
main();
