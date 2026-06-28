// Seed ~7,300 world cities (Natural Earth 10m populated places) into the cities
// collection with name/country/cc/region/population/isCapital/rank — the dataset
// behind filterable map overlays. Repeatable: clears then bulk-inserts.
//
//   cd worker && yarn seed:cities
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";

const URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson";

/* eslint-disable @typescript-eslint/no-explicit-any */
(async () => {
  console.log("[seedCities] fetching Natural Earth 10m populated places…");
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  const gj: any = await res.json();
  const feats: any[] = gj.features ?? [];

  let idx = 0;
  const docs = feats
    .map((f) => {
      const p = f.properties ?? {};
      const c = f.geometry?.coordinates ?? [];
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      const name = p.NAME || p.NAMEASCII;
      if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      return {
        id: `ne-${idx++}`,
        name: String(name),
        country: String(p.ADM0NAME || p.SOV0NAME || ""),
        cc: String(p.ISO_A2 || "").slice(0, 4),
        region: String(p.ADM1NAME || ""),
        lat,
        lng,
        population: Math.max(0, Math.round(Number(p.POP_MAX || p.POP_MIN || 0))),
        isCapital: p.ADM0CAP === 1 || /Admin-0 capital/i.test(p.FEATURECLA || ""),
        rank: Number.isFinite(Number(p.SCALERANK)) ? Number(p.SCALERANK) : 10,
      };
    })
    .filter(Boolean);

  const db = await getAppDb();
  await db.cities.deleteMany({});
  const inserted = await db.cities.model.insertMany(docs as any[], { ordered: false });
  console.log(`[seedCities] inserted ${inserted.length} cities`);
  setTimeout(() => process.exit(0), 300);
})().catch((err) => {
  console.error("[seedCities]", err);
  process.exit(1);
});
