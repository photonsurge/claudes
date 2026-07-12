/**
 * One-shot migration — `yarn migrate:blobs`. Thin CLI wrapper over `migrateBlobs`
 * (worker/src/blob/migrate.ts), which is also the `maintenance.migrateBlobs`
 * admin-Jobs button. Moves every Mongo-stored blob (textures, frame archives,
 * aurora/geomag/satimg caches, ad + admin-image uploads) onto the shared
 * `${BLOB_DIR}` folder. Copy-and-verify then drop — crash-safe + idempotent; a
 * no-op if `BLOB_DIR` is unset. See the lib for the rationale.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { migrateBlobs } from "../blob/migrate";

(async () => {
  const db = await getAppDb();
  const res = await migrateBlobs(db);
  const detail = Object.entries(res.byCollection)
    .map(([label, c]) => `${label} ${c.moved}/${c.moved + c.skipped}`)
    .join(", ");
  console.log(`all done — ${res.moved} blob(s) externalised, ${res.skipped} skipped. [${detail}]`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("migrateBlobs fatal:", err);
  process.exit(1);
});
