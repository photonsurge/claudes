/**
 * One-shot: delete alerts from sources we no longer poll (default nws +
 * meteoalarm — WMO supersets them now). Reversible: re-ingest anytime with
 * ALERTS_REGIONAL=true. Override the list with PURGE_SOURCES=a,b.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { getAlertModel } from "@photonsurge/shared/db/alert-model";

(async () => {
  const sources = (process.env.PURGE_SOURCES || "nws,meteoalarm").split(",").map((s) => s.trim()).filter(Boolean);
  const db = await getAppDb();
  const Alert = getAlertModel(db.conn);
  const before = await Alert.countDocuments({ source: { $in: sources } });
  const r = await Alert.deleteMany({ source: { $in: sources } });
  console.log(`purged ${r.deletedCount}/${before} alerts from [${sources.join(", ")}]`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("purge failed:", err);
  process.exit(1);
});
