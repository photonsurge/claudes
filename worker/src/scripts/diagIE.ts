/** TEMPORARY — why won't one country's counties fuse? */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
import { alertCountryCode } from "@photonsurge/shared/alerts/country";
import polygonClipping, { type MultiPolygon } from "polygon-clipping";

const CC = process.env.DIAG_CC || "IE";

const toGeom = (g: any): MultiPolygon | null =>
  !g?.coordinates ? null : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : null;

const bounds = (m: MultiPolygon) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of m) for (const r of p) for (const [x, y] of r) {
    a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y);
  }
  return [a, b, c, d];
};
const near = (a: any, z: any, t: number) => !(a[2]+t<z[0] || z[2]+t<a[0] || a[3]+t<z[1] || z[3]+t<a[1]);

/** Grid-hashed closest approach, capped at CELL. */
const CELL = 0.05;
function gap(a: MultiPolygon, b: MultiPolygon): number {
  const g = new Map<string, number[][]>();
  for (const p of a) for (const r of p) for (const v of r) {
    const k = `${Math.floor(v[0]/CELL)},${Math.floor(v[1]/CELL)}`;
    (g.get(k) ?? g.set(k, []).get(k)!).push(v);
  }
  let best = CELL;
  for (const p of b) for (const r of p) for (const v of r) {
    const cx = Math.floor(v[0]/CELL), cy = Math.floor(v[1]/CELL);
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) {
      for (const [x,y] of g.get(`${cx+dx},${cy+dy}`) ?? []) {
        const d = Math.hypot(v[0]-x, v[1]-y);
        if (d < best) best = d;
        if (best === 0) return 0;
      }
    }
  }
  return best;
}

async function main() {
  const db = await getAppDb();
  const all = (await db.alerts.model
    .find({ active: true }, { _id: 0, id: 1, source: 1, identifier: 1, maxSeverityRank: 1, "info.event": 1, "info.area.geometry": 1, "info.area.areaDesc": 1 })
    .lean().exec()) as any[];

  const mine = all.filter((a) => alertCountryCode(a) === CC);
  console.log(`${CC}: ${mine.length} active alerts`);

  // Unique areas by name.
  const areas = new Map<string, any>();
  for (const a of mine) for (const i of a.info ?? []) for (const ar of i.area ?? []) {
    if (ar?.geometry && ar.areaDesc && !areas.has(ar.areaDesc)) areas.set(ar.areaDesc, ar.geometry);
  }
  console.log(`distinct named areas with geometry: ${areas.size}\n`);

  const list = [...areas.entries()].map(([name, g]) => ({ name, m: toGeom(g)!, box: bounds(toGeom(g)!) }));
  let touching = 0, fuse = 0, thrown = 0, apart = 0;
  const problems: string[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (!near(list[i].box, list[j].box, 0.02)) continue;
      const d = gap(list[i].m, list[j].m);
      if (d >= 0.02) { apart++; continue; }
      touching++;
      let u: MultiPolygon | null = null;
      try { u = polygonClipping.union(list[i].m, list[j].m) as MultiPolygon; } catch { thrown++; problems.push(`THREW  gap=${d.toFixed(6)}  ${list[i].name} | ${list[j].name}`); continue; }
      if (u.length < list[i].m.length + list[j].m.length) fuse++;
      else problems.push(`NOFUSE gap=${d.toFixed(6)} parts=${u.length}  ${list[i].name} | ${list[j].name}`);
    }
  }
  console.log(`neighbour pairs (gap < 0.02°): ${touching}   of which fuse: ${fuse}   threw: ${thrown}   didn't fuse: ${touching-fuse-thrown}`);
  console.log(`pairs genuinely apart: ${apart}\n`);
  for (const p of problems.slice(0, 15)) console.log("  " + p);
  process.exit(0);
}
main();
