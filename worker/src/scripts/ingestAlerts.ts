/**
 * Manual one-shot alerts ingest — `yarn ingest:alerts`. Runs every enabled
 * source once (fetch → parse → normalise → upsert) and prints a small active
 * sample. Useful for smoke-testing without waiting for the repeatable job.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { getEnabledSources } from "../alerts/registry";
import { ingestSource } from "../alerts/ingest";

(async () => {
  const db = await getAppDb();

  for (const source of getEnabledSources()) {
    try {
      const res = await ingestSource(source, db);
      console.log(`[${source.id}]`, res);
    } catch (err) {
      console.error(`[${source.id}] failed:`, err);
    }
  }

  const active = await db.alerts.list({ activeOnly: true, limit: 5 });
  console.log(
    `\nactive sample (${active.length} of top):`,
    active.map((a) => ({
      event: a.info?.[0]?.event,
      sev: a.maxSeverityRank,
      area: a.info?.[0]?.area?.[0]?.areaDesc,
      expires: a.expiresAt,
    })),
  );

  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("ingest script fatal:", err);
  process.exit(1);
});
