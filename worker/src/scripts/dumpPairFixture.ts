/**
 * TEMPORARY — dump two real neighbouring alert areas to a test fixture.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { writeFileSync } from "fs";

async function main() {
  const db = await getAppDb();
  const all = (await db.alerts.model
    .find({ active: true }, { _id: 0, "info.area.geometry": 1, "info.area.areaDesc": 1 })
    .lean()
    .exec()) as any[];

  const find = (name: string) => {
    for (const a of all) for (const i of a.info ?? []) for (const ar of i.area ?? []) {
      if (ar?.areaDesc === name && ar.geometry) return ar.geometry;
    }
    return null;
  };

  const names = ["Flevoland", "Friesland", "Overijssel"];
  const out: Record<string, unknown> = {};
  for (const n of names) {
    const g = find(n);
    if (!g) throw new Error(`missing ${n}`);
    out[n] = g;
  }
  const path = "src/alerts/__fixtures__/nl-touching-provinces.json";
  writeFileSync(path, JSON.stringify(out));
  console.log("wrote", path, JSON.stringify(out).length, "bytes");
  process.exit(0);
}

main();
