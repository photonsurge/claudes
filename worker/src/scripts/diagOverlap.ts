/** TEMPORARY — do any two blobs in the SAME bucket overlap? If so the union failed. */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
import polygonClipping, { type MultiPolygon } from "polygon-clipping";

const toGeom = (g: any): MultiPolygon | null =>
  !g?.coordinates ? null : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : null;

const boxOf = (b: any) => b.bbox as number[];
const boxOverlap = (a: number[], z: number[]) => !(a[2] < z[0] || z[2] < a[0] || a[3] < z[1] || z[3] < a[1]);

const area = (m: MultiPolygon) => {
  let t = 0;
  for (const p of m) for (const r of p) {
    let s = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
    t += Math.abs(s / 2);
  }
  return t;
};

async function main() {
  const db = await getAppDb();
  const { blobs } = await db.alertBlobs.list();
  const buckets = new Map<string, any[]>();
  for (const b of blobs) {
    const k = `${b.hazard}|${b.severityRank}|${b.country ?? "??"}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(b);
  }

  const bad: any[] = [];
  for (const [k, list] of buckets) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!boxOverlap(boxOf(list[i]), boxOf(list[j]))) continue;
        const A = toGeom(list[i].geometry), B = toGeom(list[j].geometry);
        if (!A || !B) continue;
        let inter: MultiPolygon | null = null;
        try { inter = polygonClipping.intersection(A, B) as MultiPolygon; } catch { continue; }
        if (!inter?.length) continue;
        const ov = area(inter);
        if (ov > 1e-6) bad.push({ k, ov, a: list[i].memberIds?.length, b: list[j].memberIds?.length });
      }
    }
  }
  bad.sort((x, y) => y.ov - x.ov);
  console.log(`buckets: ${buckets.size}   blobs: ${blobs.length}`);
  console.log(`\nSAME-BUCKET OVERLAPPING PAIRS (the union should have fused these): ${bad.length}`);
  for (const p of bad.slice(0, 10)) console.log(`  overlap ${p.ov.toFixed(4)} deg²  ${p.k}   (${p.a} + ${p.b} warnings)`);
  process.exit(0);
}
main();
