/**
 * Read-only enrichment coverage report — `yarn status:enrich`.
 *
 * Answers "do the Country/Region catalogs actually carry the photo + blurb the
 * broadcast on-air lede ('The Area' block) reads?" — since `enrich:countries`
 * reporting `0 candidates` only means nothing was STALE, not that anything has a
 * photo. Counts, per catalog: docs with a photo, with a blurb, checked but no
 * match, and never checked. No writes, no network.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";

type Enrichable = { wikiThumb?: string; wikiPhoto?: string; wikiExtract?: string; wikiFetchedAt?: Date };

function tally(docs: Enrichable[]) {
  let withPhoto = 0;
  let withBlurb = 0;
  let checkedNoMatch = 0;
  let neverChecked = 0;
  for (const d of docs) {
    const hasPhoto = Boolean(d.wikiThumb || d.wikiPhoto);
    const hasBlurb = Boolean(d.wikiExtract);
    if (hasPhoto) withPhoto++;
    if (hasBlurb) withBlurb++;
    if (!hasPhoto && !hasBlurb) {
      if (d.wikiFetchedAt) checkedNoMatch++;
      else neverChecked++;
    }
  }
  return { total: docs.length, withPhoto, withBlurb, checkedNoMatch, neverChecked };
}

(async () => {
  const db = await getAppDb();
  const [countries, regions] = await Promise.all([db.countries.list(), db.regions.list()]);
  const rows = {
    countries: tally(countries),
    regions: tally(regions),
  };
  for (const [name, r] of Object.entries(rows)) {
    console.log(
      `[status:enrich] ${name.padEnd(9)} total=${r.total}  photo=${r.withPhoto}  blurb=${r.withBlurb}  ` +
        `checked-no-match=${r.checkedNoMatch}  never-checked=${r.neverChecked}`,
    );
  }
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("enrichStatus fatal:", err);
  process.exit(1);
});
