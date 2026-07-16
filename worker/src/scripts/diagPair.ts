/**
 * TEMPORARY — probe ONE touching-but-unfused pair to find out why.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { simplifyGeometry } from "@photonsurge/shared/geo/simplify";
import polygonClipping, { type MultiPolygon } from "polygon-clipping";

const SIMPLIFY = 0.002;

function toGeom(g: any): MultiPolygon | null {
  if (!g?.coordinates) return null;
  if (g.type === "Polygon") return [g.coordinates] as MultiPolygon;
  if (g.type === "MultiPolygon") return g.coordinates as MultiPolygon;
  return null;
}

const A = process.env.PROBE_A || "Flevoland";
const B = process.env.PROBE_B || "Friesland";

async function main() {
  const db = await getAppDb();
  const all = (await db.alerts.model
    .find({ active: true }, { _id: 0, id: 1, "info.area.geometry": 1, "info.area.areaDesc": 1 })
    .lean()
    .exec()) as any[];

  const find = (name: string) => {
    for (const a of all) for (const i of a.info ?? []) for (const ar of i.area ?? []) {
      if (ar?.areaDesc === name && ar.geometry) return ar.geometry;
    }
    return null;
  };

  const ga = find(A);
  const gb = find(B);
  if (!ga || !gb) {
    console.log("not found", { a: !!ga, b: !!gb });
    process.exit(1);
  }

  for (const simp of [0, SIMPLIFY]) {
    const ta = simp ? simplifyGeometry(ga as never, simp) ?? ga : ga;
    const tb = simp ? simplifyGeometry(gb as never, simp) ?? gb : gb;
    const ma = toGeom(ta)!;
    const mb = toGeom(tb)!;

    // Exactly-shared vertices between the two.
    const sa = new Set<string>();
    for (const p of ma) for (const r of p) for (const v of r) sa.add(v.join(","));
    let shared = 0;
    for (const p of mb) for (const r of p) for (const v of r) if (sa.has(v.join(","))) shared++;

    let u: MultiPolygon | null = null;
    let err = "";
    try {
      u = polygonClipping.union(ma, mb) as MultiPolygon;
    } catch (e: any) {
      err = String(e?.message || e);
    }
    // Does the union actually overlap in area?
    let inter: MultiPolygon | null = null;
    try {
      inter = polygonClipping.intersection(ma, mb) as MultiPolygon;
    } catch {
      /* ignore */
    }

    console.log(`\n--- simplify=${simp} ---`);
    console.log(`  A parts=${ma.length} verts=${ma.flat(2).length}   B parts=${mb.length} verts=${mb.flat(2).length}`);
    console.log(`  exactly shared vertices: ${shared}`);
    console.log(`  union: ${err ? `THREW ${err.slice(0, 60)}` : `parts=${u!.length}`}  (partsApart=${ma.length + mb.length})`);
    console.log(`  intersection parts: ${inter ? inter.length : "threw"}`);
  }
  process.exit(0);
}

main();
