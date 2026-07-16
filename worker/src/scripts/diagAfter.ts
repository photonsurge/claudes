import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";

async function main() {
  const db = await getAppDb();
  const gens = await db.alertBlobs.model.aggregate([
    { $group: { _id: "$builtAt", n: { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: 4 },
  ]);
  console.log("generations:", gens.map((g: any) => ({ builtAt: g._id, blobs: g.n })));

  const { blobs } = await db.alertBlobs.list();
  const noCc = blobs.filter((b: any) => !b.country);
  console.log(`\nblobs=${blobs.length}  without a country=${noCc.length}`);

  const span = (b: any) => (b.bbox ? Math.round((b.bbox[2] - b.bbox[0])) : 0);
  const worst = [...blobs].sort((a: any, z: any) => span(z) - span(a)).slice(0, 8);
  console.log("\n=== widest blobs (lng span) — a wide one means over-fusing ===");
  for (const b of worst) {
    const ccs = [...new Set((b.cities ?? []).map((c: any) => c.cc))].sort();
    console.log(`  ${String(b.hazard).padEnd(12)} sev${b.severityRank} cc=${(b.country ?? "??").padEnd(3)} span=${String(span(b)).padStart(3)}°  members=${String(b.memberIds?.length).padStart(3)}  cityCC=${ccs.join(",").slice(0,40) || "-"}`);
  }
  process.exit(0);
}
main();
