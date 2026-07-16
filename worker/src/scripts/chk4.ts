import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
async function main() {
  const db = await getAppDb();
  const gens = await db.alertBlobs.model.aggregate([
    { $group: { _id: { at: "$builtAt", live: "$live" }, n: { $sum: 1 } } },
    { $sort: { "_id.at": 1 } },
  ]);
  console.log("GENERATIONS:");
  for (const g of gens) {
    const live = g._id.live === true ? "LIVE " : g._id.live === false ? "dark " : "(no flag — predates it)";
    console.log(`  ${new Date(g._id.at).toISOString()}  ${live}  blobs=${g.n}`);
  }
  const liveN = await db.alertBlobs.model.countDocuments({ live: true });
  const total = await db.alertBlobs.model.countDocuments({});
  console.log(`\nlive: ${liveN} / ${total} total`);
  console.log(liveN === 0 ? "\n=> globe EMPTY until a rebuild commits (expected on first run)" : "\n=> exactly one generation on air");
  process.exit(0);
}
main();
