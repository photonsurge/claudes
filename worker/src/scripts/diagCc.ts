import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
import { alertCountryCode } from "@photonsurge/shared/alerts/country";

async function main() {
  const db = await getAppDb();
  const all = (await db.alerts.model
    .find({ active: true }, { _id: 0, id: 1, source: 1, identifier: 1 })
    .lean().exec()) as any[];
  let known = 0;
  const bySrc: Record<string, { known: number; total: number }> = {};
  for (const a of all) {
    const cc = alertCountryCode(a);
    const s = a.source || "?";
    bySrc[s] = bySrc[s] || { known: 0, total: 0 };
    bySrc[s].total++;
    if (cc) { known++; bySrc[s].known++; }
  }
  console.log(`country resolved on ${known}/${all.length} active alerts (${Math.round(known/all.length*100)}%)`);
  for (const [s, v] of Object.entries(bySrc)) console.log(`  ${s.padEnd(12)} ${v.known}/${v.total}`);
  process.exit(0);
}
main();
