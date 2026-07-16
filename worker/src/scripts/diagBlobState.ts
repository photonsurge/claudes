/** TEMPORARY — what's actually in the blob cache right now. */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";

async function main() {
  const db = await getAppDb();
  const total = await db.alertBlobs.model.countDocuments({});
  const activeAlerts = await db.alerts.model.countDocuments({ active: true });
  const gens = await db.alertBlobs.model.aggregate([
    { $group: { _id: "$builtAt", n: { $sum: 1 } } },
    { $sort: { _id: -1 } },
    { $limit: 5 },
  ]);
  const withCities = await db.alertBlobs.model.countDocuments({ "cities.0": { $exists: true } });
  const withBbox = await db.alertBlobs.model.countDocuments({ "bbox.0": { $exists: true } });
  const sample = await db.alertBlobs.model.findOne({}, { geometry: 0 }).lean();

  console.log({ blobs: total, activeAlerts, withCities, withBbox });
  console.log("generations:", gens.map((g: any) => ({ builtAt: g._id, blobs: g.n })));
  console.log("sample:", JSON.stringify(sample)?.slice(0, 400));
  process.exit(0);
}

main();
