/** TEMPORARY — what the regroup does to the real feed. */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import { dissolveAlerts, bucketKeyOf } from "../alerts/dissolve";
import type { iAlert } from "@photonsurge/shared/db/alert-model";

const hazardOf = (a: iAlert) =>
  classifyHazard({ event: a.info?.[0]?.event, parameters: a.info?.[0]?.parameters });

async function main() {
  const db = await getAppDb();
  const index = (await db.alerts.model
    .find({ active: true }, { _id: 0, id: 1, source: 1, identifier: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1 })
    .lean().exec()) as unknown as iAlert[];
  const buckets = new Map<string, string[]>();
  for (const a of index) {
    const k = bucketKeyOf(a, hazardOf);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(a.id!);
  }
  let blobs = 0, parts = 0, verts = 0;
  for (const [, ids] of buckets) {
    const members = (await db.alerts.model
      .find({ id: { $in: ids } }, { _id: 0, id: 1, source: 1, identifier: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1, "info.area.geometry": 1, "info.area.areaDesc": 1, "info.area.geocodes": 1 })
      .lean().exec()) as unknown as iAlert[];
    const r = await dissolveAlerts(members, { hazardOf, simplifyDeg: 0.002 });
    blobs += r.blobs.length;
    for (const b of r.blobs) {
      parts += b.geometry.type === "Polygon" ? 1 : (b.geometry.coordinates as unknown[]).length;
      verts += b.verticesAfter;
    }
  }
  console.log(`\nAFTER regroup:  blobs=${blobs}  parts=${parts}  storedVerts=${verts}`);
  console.log(`BEFORE (live):  blobs=3871  parts=3871`);
  console.log(`THIS MORNING:   blobs=582`);
  console.log(`\nfeed properties are per-BLOB, so ~${(1.76 * blobs / 3871).toFixed(2)}MB (was 1.76MB)`);
  process.exit(0);
}
main();
