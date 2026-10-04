/**
 * Manual one-shot — `yarn crossword:bank-index`. Builds the indexes on the
 * imported word bank (crosswordbankwords, crosswordbankclues), the same code
 * as the /admin/jobs "Index the crossword word bank" button. Run once after
 * each import (docs/crossword-mode-plan.md §7.2 step 3); safe to re-run, an
 * existing index is left as it is. Slow on a million words.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { indexBank } from "../crossword/build";

(async () => {
  const db = await getAppDb();
  const t0 = Date.now();
  const { indexes } = await indexBank(db);
  for (const name of indexes) console.log(`index ${name}: ok`);
  console.log(`crossword bank indexed (${indexes.length} indexes, ${((Date.now() - t0) / 1000).toFixed(1)}s).`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("crossword:bank-index failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
