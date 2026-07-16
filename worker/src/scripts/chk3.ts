import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
async function main() {
  const db = await getAppDb();
  const gens = await db.alertBlobs.model.aggregate([
    { $group: { _id: "$builtAt", n: { $sum: 1 } } }, { $sort: { _id: 1 } },
  ]);
  console.log("GENERATIONS IN THE COLLECTION:");
  for (const g of gens) console.log(`  ${new Date(g._id).toISOString()}  blobs=${g.n}`);
  console.log(`\ntotal blobs: ${gens.reduce((n: number, g: any) => n + g.n, 0)}`);
  console.log(`If more than ONE generation is listed, every shape is drawn once per generation.`);
  process.exit(0);
}
main();
