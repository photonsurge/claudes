/**
 * TEMPORARY diagnostic — not part of the build.
 *
 * Re-runs the real dissolve against live alerts and reports every pair that the
 * greedy pass DIDN'T fuse, with the true minimum distance between the two shapes.
 * The question it answers: at 200m thinning, are there still pairs that visibly
 * touch (gap ~0) and still end up as separate blobs with a seam between them?
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import { simplifyGeometry } from "@photonsurge/shared/geo/simplify";
import type { iAlert } from "@photonsurge/shared/db/alert-model";
import polygonClipping, { type MultiPolygon } from "polygon-clipping";

const SIMPLIFY = Number(process.env.ALERT_DISSOLVE_SIMPLIFY_DEG || 0.002);
const TOL = 0.02;

const hazardOf = (a: iAlert) =>
  classifyHazard({ event: a.info?.[0]?.event, parameters: a.info?.[0]?.parameters });

const countVertices = (c: unknown): number => {
  if (!Array.isArray(c)) return 0;
  if (typeof c[0] === "number") return 1;
  return (c as unknown[]).reduce<number>((n, x) => n + countVertices(x), 0);
};

function toGeom(g: any): MultiPolygon | null {
  if (!g?.coordinates) return null;
  if (g.type === "Polygon") return [g.coordinates] as MultiPolygon;
  if (g.type === "MultiPolygon") return g.coordinates as MultiPolygon;
  return null;
}

function bounds(geom: MultiPolygon): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of geom) for (const r of p) for (const [x, y] of r) {
    if (x < a) a = x;
    if (y < b) b = y;
    if (x > c) c = x;
    if (y > d) d = y;
  }
  return [a, b, c, d];
}

const near = (a: any, b: any, tol: number) =>
  !(a[2] + tol < b[0] || b[2] + tol < a[0] || a[3] + tol < b[1] || b[3] + tol < a[1]);

/**
 * Closest approach between two shapes' vertices, via a grid hash.
 *
 * The all-pairs version of this is what the question really asks for, but at full
 * precision the worst bucket is ~1.15M vertices and O(n*m) simply never returns —
 * it hung this script. We only need to tell "touching" from "Sicily, 150km of open
 * sea", so bin A's vertices at CELL and probe each of B's against the 3x3
 * neighbourhood: exact under CELL, and anything further just reports as CELL,
 * which is all the classification needs.
 */
const CELL = 0.02;
function minVertexGap(a: MultiPolygon, b: MultiPolygon): number {
  const grid = new Map<string, number[][]>();
  for (const p of a) for (const r of p) for (const v of r) {
    const k = `${Math.floor(v[0] / CELL)},${Math.floor(v[1] / CELL)}`;
    const cell = grid.get(k);
    if (cell) cell.push(v);
    else grid.set(k, [v]);
  }
  let best = CELL;
  for (const p of b) for (const r of p) for (const v of r) {
    const cx = Math.floor(v[0] / CELL);
    const cy = Math.floor(v[1] / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get(`${cx + dx},${cy + dy}`);
        if (!cell) continue;
        for (const [x, y] of cell) {
          const d = Math.hypot(v[0] - x, v[1] - y);
          if (d < best) best = d;
          if (best === 0) return 0;
        }
      }
    }
  }
  return best;
}

const areaKey = (ar: any): string => {
  const emma = ar.geocodes?.find((g: any) => g.valueName?.toUpperCase() === "EMMA_ID")?.value;
  if (emma) return `emma:${emma}`;
  if (ar.areaDesc) return `desc:${ar.areaDesc}`;
  const c = ar.geometry?.coordinates;
  return `geom:${ar.geometry?.type}:${countVertices(c)}:${JSON.stringify(c?.[0]?.[0] ?? null)}`;
};

function distinctAreas(members: iAlert[]) {
  const by = new Map<string, { geometry: any; ids: Set<string>; desc: string }>();
  for (const a of members) {
    for (const i of a.info ?? []) {
      for (const ar of (i as any).area ?? []) {
        if (!ar?.geometry) continue;
        const k = areaKey(ar);
        const hit = by.get(k);
        if (hit) hit.ids.add(a.id!);
        else by.set(k, { geometry: ar.geometry, ids: new Set([a.id!]), desc: ar.areaDesc || k });
      }
    }
  }
  return [...by.values()];
}

async function main() {
  const db = await getAppDb();
  const all = (await db.alerts.model
    .find({ active: true }, { _id: 0, id: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1, "info.area.geometry": 1, "info.area.areaDesc": 1, "info.area.geocodes": 1 })
    .lean()
    .exec()) as unknown as iAlert[];

  const buckets = new Map<string, iAlert[]>();
  for (const a of all) {
    const k = `${hazardOf(a)}|${a.maxSeverityRank}`;
    const arr = buckets.get(k);
    if (arr) arr.push(a);
    else buckets.set(k, [a]);
  }

  const throwPairs: any[] = [];
  const disjointTouching: any[] = [];

  for (const [key, members] of buckets) {
    type B = { geom: MultiPolygon; box: any; desc: string[] };
    const blobs: B[] = [];
    for (const area of distinctAreas(members)) {
      const thinned = SIMPLIFY ? simplifyGeometry(area.geometry as never, SIMPLIFY) ?? area.geometry : area.geometry;
      const geom = toGeom(thinned);
      if (!geom) continue;
      const box = bounds(geom);
      const hits = blobs.filter((b) => near(b.box, box, TOL));
      if (!hits.length) {
        blobs.push({ geom, box, desc: [area.desc] });
        continue;
      }
      let merged = geom;
      let descs = [area.desc];
      const fused: B[] = [];
      for (const b of hits) {
        const partsApart = merged.length + b.geom.length;
        let u: MultiPolygon | null = null;
        let threw: string | null = null;
        try {
          u = polygonClipping.union(merged, b.geom) as MultiPolygon;
        } catch (e: any) {
          threw = String(e?.message || e).slice(0, 80);
        }
        if (!u) {
          const gap = minVertexGap(merged, b.geom);
          throwPairs.push({ key, a: descs.join("+").slice(0, 40), b: b.desc.join("+").slice(0, 40), gap: gap.toFixed(5), err: threw });
          continue;
        }
        if (u.length >= partsApart) {
          // Record the gap for EVERY skipped pair and bucket it afterwards. A
          // fixed threshold here would lie: thinning at 0.002 can push a
          // genuinely-touching border up to 0.002 apart, so anything under the
          // tolerance in force is "we broke this", not "they're really apart".
          disjointTouching.push({
            key,
            a: descs.join("+").slice(0, 40),
            b: b.desc.join("+").slice(0, 40),
            gap: minVertexGap(merged, b.geom),
          });
          continue;
        }
        merged = u;
        descs = descs.concat(b.desc);
        fused.push(b);
      }
      for (const b of fused) blobs.splice(blobs.indexOf(b), 1);
      blobs.push({ geom: merged, box: bounds(merged), desc: descs });
    }
  }

  // "Really apart" (Sicily, 150km of sea) vs "we pulled them apart" (a shared
  // border thinned differently on each side) is a question about the GAP, and the
  // only honest cut is the tolerance in force: a pair closer than that was
  // touching in the source.
  const broke = disjointTouching.filter((p) => p.gap <= Math.max(SIMPLIFY, 1e-9));
  const genuinelyApart = disjointTouching.filter((p) => p.gap > Math.max(SIMPLIFY, 1e-9));

  console.log(`\n=== simplify=${SIMPLIFY} ===`);
  console.log(`UNION THREW (${throwPairs.length}):`);
  for (const p of throwPairs) console.log(`  gap ${Number(p.gap).toFixed(6)}°  ${p.key}  ${p.a} | ${p.b}  -- ${p.err}`);
  console.log(`\nSKIPPED, GAP <= tolerance — a border we broke (${broke.length}):`);
  for (const p of broke) console.log(`  gap ${p.gap.toFixed(6)}°  ${p.key}  ${p.a} | ${p.b}`);
  console.log(`\nSKIPPED, genuinely apart (${genuinelyApart.length}) — gaps: ${genuinelyApart.map((p) => p.gap.toFixed(3)).slice(0, 12).join(", ")}`);
  console.log(`\nTOTAL NOT FUSED: ${throwPairs.length + broke.length}`);
  console.log("");
  process.exit(0);
}

main();
