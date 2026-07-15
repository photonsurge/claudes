import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import { simplifyGeometry } from "@photonsurge/shared/geo/simplify";
import { dissolveAlerts, bucketKeyOf } from "../alerts/dissolve";
import type { iAlert } from "@photonsurge/shared/db/alert-model";

const mb = () => Math.round(process.memoryUsage().heapUsed / 1e6);
const hazardOf = (a: iAlert) => classifyHazard({ event: a.info?.[0]?.event, parameters: a.info?.[0]?.parameters });
const count = (c: any): number => !Array.isArray(c) ? 0 : typeof c[0] === "number" ? 1 : c.reduce((n: number, x: any) => n + count(x), 0);

(async () => {
  const db = await getAppDb();
  const index = (await db.alerts.model.find({ active: true }, { _id: 0, id: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1 }).lean().exec()) as unknown as iAlert[];
  const buckets = new Map<string, string[]>();
  for (const a of index) { const k = bucketKeyOf(a, hazardOf); (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(a.id!); }
  const [key, ids] = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  index.length = 0;

  const members = (await db.alerts.model.find({ id: { $in: ids } }, { _id: 0, id: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1, "info.area.geometry": 1 }).lean().exec()) as unknown as iAlert[];
  const raw = members.reduce((n, m) => n + (m.info ?? []).reduce((x, i) => x + (i.area ?? []).reduce((y, a) => y + count(a.geometry?.coordinates), 0), 0), 0);
  console.log(`worst bucket ${key}: ${ids.length} alerts, ${raw} vertices, heap ${mb()}MB`);

  const DEG = Number(process.env.SIMP || 0.01);
  const t0 = Date.now();
  for (const m of members) for (const i of m.info ?? []) for (const a of i.area ?? []) {
    if (a.geometry) a.geometry = simplifyGeometry(a.geometry as never, DEG) as never;
  }
  const simp = members.reduce((n, m) => n + (m.info ?? []).reduce((x, i) => x + (i.area ?? []).reduce((y, a) => y + count(a.geometry?.coordinates), 0), 0), 0);
  if (global.gc) global.gc();
  console.log(`after simplify @${DEG}°: ${simp} vertices (${Math.round((1 - simp / raw) * 100)}% fewer) in ${Date.now() - t0}ms, heap ${mb()}MB`);

  const t1 = Date.now();
  const r = await dissolveAlerts(members, { hazardOf });
  console.log(`dissolve: ${((Date.now() - t1) / 1000).toFixed(0)}s, ${r.blobs.length} blobs, ${r.unionFailures} failures, PEAK heap ${mb()}MB`);
  process.exit(0);
})();
