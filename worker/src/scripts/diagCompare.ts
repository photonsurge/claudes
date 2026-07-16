/**
 * TEMPORARY — the controlled test: thin-the-INPUTS vs thin-the-OUTPUT, on ONE
 * snapshot of alerts, bucket by bucket.
 *
 * Everything measured before this compared runs minutes apart against a live feed
 * that was ingesting the whole time, so the numbers moved for reasons that had
 * nothing to do with the change. Here each bucket is fetched ONCE and both
 * variants run on that same array.
 *
 * The metric is BLOBS: fewer blobs means more areas fused, which is the entire
 * point of the job. Union failures are a symptom; a seam on the globe is the bug.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import { simplifyGeometry } from "@photonsurge/shared/geo/simplify";
import type { iAlert } from "@photonsurge/shared/db/alert-model";
import { dissolveAlerts, bucketKeyOf } from "../alerts/dissolve";

const DEG = Number(process.env.CMP_DEG || 0.002);
const hazardOf = (a: iAlert) =>
  classifyHazard({ event: a.info?.[0]?.event, parameters: a.info?.[0]?.parameters });

/** Pre-thin every area, i.e. exactly what the old code fed the clipper. */
function thinInputs(alerts: iAlert[], deg: number): iAlert[] {
  return alerts.map((a) => ({
    ...a,
    info: (a.info ?? []).map((i: any) => ({
      ...i,
      area: (i.area ?? []).map((ar: any) => ({
        ...ar,
        geometry: ar.geometry ? simplifyGeometry(ar.geometry, deg) : ar.geometry,
      })),
    })),
  })) as iAlert[];
}

async function main() {
  const db = await getAppDb();
  const index = (await db.alerts.model
    .find({ active: true }, { _id: 0, id: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1 })
    .lean()
    .exec()) as unknown as iAlert[];

  const buckets = new Map<string, string[]>();
  for (const a of index) {
    const k = bucketKeyOf(a, hazardOf);
    const ids = buckets.get(k);
    if (ids) ids.push(a.id!);
    else buckets.set(k, [a.id!]);
  }
  index.length = 0;

  const tally = {
    thinInputs: { blobs: 0, fail: 0, verts: 0, ms: 0 },
    thinOutput: { blobs: 0, fail: 0, verts: 0, ms: 0 },
  };

  for (const [key, ids] of buckets) {
    let members: iAlert[] | null = (await db.alerts.model
      .find(
        { id: { $in: ids } },
        { _id: 0, id: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1, "info.area.geometry": 1, "info.area.areaDesc": 1, "info.area.geocodes": 1 },
      )
      .lean()
      .exec()) as unknown as iAlert[];

    // OLD: clipper sees thinned shapes; nothing thinned afterwards.
    let t0 = Date.now();
    const a = await dissolveAlerts(thinInputs(members, DEG), { hazardOf, simplifyDeg: 0 });
    tally.thinInputs.ms += Date.now() - t0;
    tally.thinInputs.blobs += a.blobs.length;
    tally.thinInputs.fail += a.unionFailures;
    for (const b of a.blobs) tally.thinInputs.verts += b.verticesAfter;

    // NEW: clipper sees the boundary as issued; the finished blob is thinned.
    t0 = Date.now();
    const b = await dissolveAlerts(members, { hazardOf, simplifyDeg: DEG });
    tally.thinOutput.ms += Date.now() - t0;
    tally.thinOutput.blobs += b.blobs.length;
    tally.thinOutput.fail += b.unionFailures;
    for (const x of b.blobs) tally.thinOutput.verts += x.verticesAfter;

    members = null;
    console.log(
      `  ${key.padEnd(22)} inputs=${String(a.blobs.length).padStart(4)} output=${String(b.blobs.length).padStart(4)}`,
    );
  }

  console.log(`\n=== same snapshot, deg=${DEG} — fewer blobs = more fusing = fewer seams ===`);
  for (const [name, t] of Object.entries(tally)) {
    console.log(
      `  ${name.padEnd(11)} blobs=${String(t.blobs).padStart(4)}  unionFailures=${String(t.fail).padStart(4)}  storedVerts=${String(t.verts).padStart(8)}  ${(t.ms / 1000).toFixed(1)}s`,
    );
  }
  console.log(`\n  heap peak: ${Math.round(process.memoryUsage().heapUsed / 1e6)}MB`);
  process.exit(0);
}

main();
