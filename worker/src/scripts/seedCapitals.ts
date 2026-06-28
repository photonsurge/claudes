// Seed every national capital from Natural Earth into the cities collection.
// Repeatable: clears existing cities, then inserts all Admin-0 capitals via the
// City model (proper uuid id + timestamps).
//
//   cd worker && yarn seed:capitals
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";

const URL =
  "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_populated_places.geojson";

/* eslint-disable @typescript-eslint/no-explicit-any */
(async () => {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  const gj: any = await res.json();
  const caps = (gj.features ?? []).filter((f: any) =>
    /Admin-0 capital/i.test(f?.properties?.FEATURECLA ?? ""),
  );

  const db = await getAppDb();
  await db.cities.deleteMany({});

  let n = 0;
  for (const f of caps) {
    const p = f.properties ?? {};
    const coords = f.geometry?.coordinates ?? [];
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    const name = p.NAME || p.NAMEASCII;
    if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    await db.cities.create({
      name: String(name),
      country: String(p.ADM0NAME || p.SOV0NAME || ""),
      lat,
      lng,
      population: Math.max(0, Math.round(Number(p.POP_MAX || p.POP_MIN || 0))),
      isCapital: true,
    });
    n++;
  }
  console.log(`[seedCapitals] inserted ${n} capitals`);
  setTimeout(() => process.exit(0), 250);
})().catch((err) => {
  console.error("[seedCapitals]", err);
  process.exit(1);
});
