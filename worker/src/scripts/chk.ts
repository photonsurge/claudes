import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
import { isSeam, MIN_HOLE_AREA_DEG2 } from "../alerts/slivers";

async function main() {
  const db = await getAppDb();
  const { blobs } = await db.alertBlobs.list();
  const byGen = new Map<string, any[]>();
  for (const b of blobs) {
    const k = new Date(b.builtAt).toISOString();
    (byGen.get(k) ?? byGen.set(k, []).get(k)!).push(b);
  }
  // PER GENERATION — mixing them was how the last check lied to me.
  for (const [gen, list] of [...byGen.entries()].sort()) {
    let holes = 0, seams = 0;
    for (const b of list) {
      const g: any = b.geometry;
      if (!g?.coordinates) continue;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      for (const p of polys) for (let i = 1; i < p.length; i++) {
        holes++;
        if (isSeam(p[i], MIN_HOLE_AREA_DEG2)) seams++;
      }
    }
    const cc = list.filter((b) => b.country).length;
    console.log(`${gen}  blobs=${String(list.length).padStart(4)}  country=${String(cc).padStart(4)}/${list.length}  holes=${String(holes).padStart(5)}  stillSeams=${seams}`);
  }
  process.exit(0);
}
main();
