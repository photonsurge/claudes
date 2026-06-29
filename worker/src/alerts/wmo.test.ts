import { featuresToCapMessages } from "./wmo";

/** Two polygon rows sharing a capurl + one excluded-country row. */
const features = [
  {
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    properties: { capurl: "cn-cma-xx/2026/a.xml", event: "Strong Thunderstorms", s: 1, u: 2, c: 3, sent: "2026-06-29T10:00:00Z", expires: "2026-06-29T20:00:00Z", areadesc: "Beijing", mem: "001", marine: "0" },
  },
  {
    geometry: { type: "Polygon", coordinates: [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]] },
    properties: { capurl: "cn-cma-xx/2026/a.xml", event: "Strong Thunderstorms", s: 1, sent: "2026-06-29T10:00:00Z", expires: "2026-06-29T20:00:00Z", areadesc: "Beijing", mem: "001" },
  },
  {
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    properties: { capurl: "us-noaa-nws-en/2026/b.xml", event: "Heat Advisory", s: 2, sent: "2026-06-29T09:00:00Z", expires: "2026-06-29T21:00:00Z", areadesc: "Cook", mem: "093" },
  },
];

describe("featuresToCapMessages", () => {
  it("groups polygon rows by capurl into one alert with merged geometry", () => {
    const msgs = featuresToCapMessages(features as any, new Set());
    expect(msgs).toHaveLength(2); // two distinct capurls
    const cn = msgs.find((m) => m.identifier === "cn-cma-xx/2026/a.xml")!;
    const geom = cn.info[0].area[0].geometry!;
    expect(geom.type).toBe("MultiPolygon"); // two rows merged
    expect((geom.coordinates as unknown[]).length).toBe(2);
  });

  it("maps severity ordinal s → rank (rank = s)", () => {
    const msgs = featuresToCapMessages(features as any, new Set());
    const cn = msgs.find((m) => m.identifier.startsWith("cn"))!;
    expect(cn.info[0].severityRank).toBe(1); // s=1 → Minor
    expect(cn.info[0].severity).toBe("Minor");
    const us = msgs.find((m) => m.identifier.startsWith("us"))!;
    expect(us.info[0].severityRank).toBe(2); // s=2 → Moderate
  });

  it("excludes countries by ISO-2 prefix", () => {
    const msgs = featuresToCapMessages(features as any, new Set(["us"]));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].identifier.startsWith("cn")).toBe(true);
  });

  it("winds the outer ring CCW for the 2dsphere index", () => {
    // A clockwise square should come back counter-clockwise (signed area > 0).
    const cw = [{ geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] }, properties: { capurl: "cn-cma-xx/2026/c.xml", event: "Wind", s: 2, sent: "x", expires: "2026-06-29T20:00:00Z" } }];
    const ring = (featuresToCapMessages(cw as any, new Set())[0].info[0].area[0].geometry!.coordinates as number[][][])[0];
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    expect(a / 2).toBeGreaterThan(0);
  });
});
