/**
 * Manual one-shot camera-catalogue refresh — `yarn refresh:cams [source]`.
 * Pulls each enabled camera source (or just the named one, e.g.
 * `yarn refresh:cams tfl`) into Mongo once and prints the totals. Use this to
 * seed the catalog without waiting out the scheduled worker ingest.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { getEnabledCamSources, getCamSource } from "../cams/registry";
import { ingestCamSource } from "../cams/ingest";

(async () => {
  const id = process.argv[2];
  const sources = id
    ? [getCamSource(id)].filter((s): s is NonNullable<typeof s> => Boolean(s))
    : getEnabledCamSources();

  if (!sources.length) {
    console.error(
      id
        ? `cams refresh: no source "${id}" (or it's disabled)`
        : `cams refresh: no enabled sources — set WINDY_WEBCAMS_API_KEY, or CAMS_TFL_ENABLED, etc.`,
    );
    process.exit(1);
  }

  const db = await getAppDb();
  for (const source of sources) {
    try {
      const r = await ingestCamSource(source, db);
      console.log(`cams refresh [${source.id}]:`, r);
    } catch (err) {
      console.error(`cams refresh [${source.id}] failed:`, err);
    }
  }
  console.log("total cams in Mongo:", await db.cams.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshCams fatal:", err);
  process.exit(1);
});
