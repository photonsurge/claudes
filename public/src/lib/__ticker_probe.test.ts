import { buildTicker } from "./broadcast";
import type { AlertFeature } from "./alerts";
import type { City } from "./cities";

// Realistic polygon alert over Saudi Arabia (Asir region-ish).
const poly = (id: string, cx: number, cy: number): AlertFeature =>
  ({
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[[cx, cy], [cx + 1, cy], [cx + 1, cy + 1], [cx, cy + 1], [cx, cy]]],
    },
    properties: {
      id,
      source: "wmo",
      identifier: id,
      event: "High temperature",
      severityRank: 4 as AlertFeature["properties"]["severityRank"],
      hazard: "heat" as AlertFeature["properties"]["hazard"],
      areaDesc: "Asir region",
    },
  }) as AlertFeature;

// 15k synthetic cities scattered over the globe.
const cities: City[] = Array.from({ length: 15000 }, (_, i) =>
  ({
    id: `c${i}`,
    name: `City${i}`,
    lat: -85 + (i % 170),
    lng: -180 + ((i * 7) % 360),
    cc: "SA",
    population: 50_000,
  }) as City,
);

test("probe: buildTicker returns items + timing at scale", () => {
  const alerts = Array.from({ length: 400 }, (_, i) => {
    const a = poly(`a${i}`, (i % 60) - 30, (i % 40) - 20);
    a.properties.areaDesc = `Distinct Area ${i}`; // realistic: every alert a different place
    return a;
  });
  const t0 = process.hrtime.bigint();
  const items = buildTicker({ alerts, quakes: [], tracks: [], cities });
  const t1 = process.hrtime.bigint();
  // eslint-disable-next-line no-console
  console.log(`ITEMS=${items.length} SAMPLE=${JSON.stringify(items[0])} MS=${Number(t1 - t0) / 1e6}`);
  expect(items.length).toBeGreaterThan(0);
});
