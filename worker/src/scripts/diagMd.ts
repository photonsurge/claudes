/** TEMPORARY — does the parts explosion actually fuse Moldova? */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
import { alertCountryCode } from "@photonsurge/shared/alerts/country";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import { dissolveAlerts } from "../alerts/dissolve";
import type { iAlert } from "@photonsurge/shared/db/alert-model";

const hazardOf = (a: iAlert) =>
  classifyHazard({ event: a.info?.[0]?.event, parameters: a.info?.[0]?.parameters });

const countRings = (g: any): number => {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.reduce((n: number, p: any) => n + p.length, 0);
};

async function main() {
  const db = await getAppDb();
  const all = (await db.alerts.model
    .find({ active: true }, { _id: 0, id: 1, source: 1, identifier: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1, "info.area.geometry": 1, "info.area.areaDesc": 1 })
    .lean().exec()) as unknown as iAlert[];

  for (const cc of ["MD", "IE"]) {
    const mine = all.filter((a) => alertCountryCode(a) === cc);
    if (!mine.length) { console.log(`${cc}: no alerts`); continue; }
    const srcParts = mine.reduce((n, a) => {
      for (const i of a.info ?? []) for (const ar of (i as any).area ?? []) {
        const g = ar.geometry;
        n += g?.type === "MultiPolygon" ? g.coordinates.length : g?.type === "Polygon" ? 1 : 0;
      }
      return n;
    }, 0);
    const r = await dissolveAlerts(mine, { hazardOf, simplifyDeg: 0.002 });
    const outParts = r.blobs.reduce((n, b: any) => n + (b.geometry.type === "Polygon" ? 1 : b.geometry.coordinates.length), 0);
    const rings = r.blobs.reduce((n, b: any) => n + countRings(b.geometry), 0);
    console.log(`${cc}: ${mine.length} alerts, ${srcParts} source county polygons  =>  ${r.blobs.length} blobs / ${outParts} parts / ${rings} rings drawn   (failures ${r.unionFailures}, slivers dropped ${r.slivers.dropped})`);
  }
  process.exit(0);
}
main();
