/**
 * TEMPORARY — where do the 12 seconds of /api/alerts actually go?
 * Mirror the route's stages and time each one.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
import { simplifyGeometry } from "@photonsurge/shared/geo/simplify";

const t = async <T>(label: string, fn: () => Promise<T> | T): Promise<T> => {
  const t0 = Date.now();
  const r = await fn();
  console.log(`  ${label.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms`);
  return r;
};

async function main() {
  const db = await getAppDb();

  const alerts: any[] = await t("1. Mongo list (lean, 5000)", () =>
    db.alerts.list({ activeOnly: true, limit: 5000, lean: true }) as any,
  );
  console.log(`     -> ${alerts.length} alerts`);

  let verts = 0;
  for (const a of alerts) for (const i of a.info ?? []) for (const ar of i.area ?? []) {
    const c = ar.geometry?.coordinates;
    verts += JSON.stringify(c ?? "").length;
  }
  console.log(`     -> ~${(verts / 1e6).toFixed(1)}M chars of coordinates`);

  await t("2. simplify every area (0.05)", () => {
    for (const a of alerts) for (const i of a.info ?? []) for (const ar of i.area ?? []) {
      if (ar?.geometry) ar.geometry = simplifyGeometry(ar.geometry, 0.05);
    }
  });

  await t("3. JSON.stringify (the payload)", () => JSON.stringify({ alerts, count: alerts.length }).length);

  // What the clustering costs: a bbox per alert, walked off the coordinates.
  const bboxOf = (a: any) => {
    let w = Infinity, s2 = Infinity, e = -Infinity, n = -Infinity;
    const walk = (c: any) => {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === "number") {
        w = Math.min(w, c[0]); e = Math.max(e, c[0]);
        s2 = Math.min(s2, c[1]); n = Math.max(n, c[1]);
        return;
      }
      for (const x of c) walk(x);
    };
    for (const i of a.info ?? []) for (const ar of i.area ?? []) walk(ar.geometry?.coordinates);
    return w === Infinity ? null : [w, s2, e, n];
  };
  await t("4. bbox per alert (the clustering)", () => { for (const a of alerts) bboxOf(a); });

  // And what a rep point costs, derived per alert the way broadcast.ts does.
  await t("5. rep point per alert (world watch)", () => {
    for (const a of alerts) {
      for (const i of a.info ?? []) for (const ar of i.area ?? []) {
        const c = ar.geometry?.coordinates;
        if (c) { JSON.stringify(c).length; break; }
      }
    }
  });

  process.exit(0);
}
main();
