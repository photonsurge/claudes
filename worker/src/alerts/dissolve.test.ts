import type { iAlert } from "@photonsurge/shared/db/alert-model";
import { signedArea, type Ring } from "@photonsurge/shared/alerts/rings";
import { dissolveAlerts } from "./dissolve";

/** An alert covering one square — the shape of a MeteoAlarm county warning. */
const county = (id: string, event: string, rank: number, [w, s, e, n]: number[]): iAlert =>
  ({
    id,
    source: "meteoalarm",
    identifier: id,
    maxSeverityRank: rank,
    info: [
      {
        event,
        severityRank: rank,
        area: [
          {
            areaDesc: id,
            geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
            geocodes: [],
          },
        ],
      },
    ],
  }) as unknown as iAlert;

const hazardOf = (a: iAlert) => a.info[0].event;
const NO_WAIT = { hazardOf, yield: async () => {}, yieldEvery: 1 };
const run = async (alerts: iAlert[]) => (await dissolveAlerts(alerts, NO_WAIT)).blobs;

describe("dissolveAlerts", () => {
  it("fuses two touching counties into one shape", async () => {
    // Share the edge at x=1 — exactly how neighbouring EMMA counties meet.
    const out = await run([county("a", "Thunderstorm", 3, [0, 0, 1, 1]), county("b", "Thunderstorm", 3, [1, 0, 2, 1])]);

    expect(out).toHaveLength(1);
    expect(out[0].memberIds.sort()).toEqual(["a", "b"]);
    expect(out[0].geometry.type).toBe("Polygon");
    // The shared border vertices are gone — that's the memory win.
    expect(out[0].verticesAfter).toBeLessThan(out[0].verticesBefore);
  });

  it("chains a run of counties into ONE blob (adjacency is transitive)", async () => {
    const out = await run([
      county("a", "Thunderstorm", 3, [0, 0, 1, 1]),
      county("b", "Thunderstorm", 3, [1, 0, 2, 1]),
      county("c", "Thunderstorm", 3, [2, 0, 3, 1]),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].memberIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("fuses two blobs when a later area bridges them", async () => {
    // c arrives last and joins a and b, which were separate until then.
    const out = await run([
      county("a", "Thunderstorm", 3, [0, 0, 1, 1]),
      county("b", "Thunderstorm", 3, [2, 0, 3, 1]),
      county("c", "Thunderstorm", 3, [1, 0, 2, 1]),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].memberIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps distant counties apart", async () => {
    const out = await run([county("a", "Thunderstorm", 3, [0, 0, 1, 1]), county("b", "Thunderstorm", 3, [50, 50, 51, 51])]);

    expect(out).toHaveLength(2);
  });

  it("NEVER fuses different severities — a red area must not be painted amber", async () => {
    const out = await run([county("a", "Thunderstorm", 4, [0, 0, 1, 1]), county("b", "Thunderstorm", 2, [1, 0, 2, 1])]);

    expect(out).toHaveLength(2);
    expect(out.map((b) => b.severityRank).sort()).toEqual([2, 4]);
  });

  it("never fuses different hazards", async () => {
    const out = await run([county("a", "Thunderstorm", 3, [0, 0, 1, 1]), county("b", "Flood", 3, [1, 0, 2, 1])]);

    expect(out).toHaveLength(2);
  });

  it("leaves a hairline gap unbridged rather than inventing a join", async () => {
    // b starts a whisker past a's edge. This used to assert ONE blob — but the
    // bbox tolerance never bridged anything: it only widened the candidate net,
    // and the union then returned both shapes as separate parts of a single blob.
    // That WAS the bug (disjoint weather drawn as one thing), not a feature.
    const out = await run([county("a", "Thunderstorm", 3, [0, 0, 1, 1]), county("b", "Thunderstorm", 3, [1.001, 0, 2, 1])]);

    expect(out).toHaveLength(2);
  });

  /**
   * The rule, in the operator's words: only collapse areas that are next to each
   * other or joined. A bounding box can't decide that — Sicily's box overlaps the
   * Italian mainland's across 150km of sea — and unioning two disjoint shapes
   * still "succeeds", it just hands back both parts. So separate weather was
   * being collapsed into one blob and drawn as one thing.
   */
  describe("only fuses what actually touches", () => {
    it("keeps an island separate from the mainland it overlaps the box of", async () => {
      // Sicily-ish and Puglia-ish: boxes overlap in latitude, land never meets.
      const sicily = county("sicily", "Heat", 4, [12.4, 36.6, 15.6, 38.3]);
      const puglia = county("puglia", "Heat", 4, [14.9, 39.8, 18.5, 41.9]);

      const out = await run([sicily, puglia]);

      expect(out).toHaveLength(2);
      expect(out.map((b) => b.memberIds).flat().sort()).toEqual(["puglia", "sicily"]);
    });

    it("still fuses two areas that share a border", async () => {
      const out = await run([county("a", "Heat", 4, [0, 0, 1, 1]), county("b", "Heat", 4, [1, 0, 2, 1])]);

      expect(out).toHaveLength(1);
      expect(out[0].geometry.type).toBe("Polygon");
    });

    it("does not let a gap be bridged just because the boxes are close", async () => {
      const out = await run([county("a", "Heat", 4, [0, 0, 1, 1]), county("b", "Heat", 4, [1.01, 0, 2, 1])]);

      expect(out).toHaveLength(2);
    });
  });

  it("ignores areas with no geometry instead of throwing", async () => {
    const bare = county("x", "Thunderstorm", 3, [0, 0, 1, 1]);
    bare.info[0].area[0].geometry = null;

    expect(await run([bare])).toEqual([]);
  });

  it("handles an empty input", async () => {
    expect(await run([])).toEqual([]);
  });

  /**
   * Thinning before the clip is what makes this job fit on the server. Source
   * boundaries are survey-grade (the worst hazard alone is ~1.15M vertices) and
   * clipping at that precision is where the time and memory go — to produce a
   * shape the overlay then simplifies to ~5km anyway before drawing it. Measured:
   * 91% fewer vertices, dissolve 40s -> 3s, peak heap 711MB -> 289MB.
   */
  describe("simplifyDeg", () => {
    /** A ragged coastline: a box with many near-collinear points along one edge. */
    const ragged = (id: string): iAlert => {
      const ring: number[][] = [];
      for (let i = 0; i <= 200; i++) ring.push([i * 0.001, (i % 2) * 0.00001]);
      ring.push([0.2, 1], [0, 1], [0, 0]);
      return {
        id,
        maxSeverityRank: 3,
        info: [{ event: "Heat", severityRank: 3, area: [{ areaDesc: id, geometry: { type: "Polygon", coordinates: [ring] } }] }],
      } as unknown as iAlert;
    };

    it("thins the source before clipping it", async () => {
      const out = await dissolveAlerts([ragged("a")], { ...NO_WAIT, simplifyDeg: 0.01 });

      expect(out.blobs[0].verticesAfter).toBeLessThan(20);
    });

    it("keeps the source exactly when thinning is off", async () => {
      const out = await dissolveAlerts([ragged("a")], { ...NO_WAIT, simplifyDeg: 0 });

      expect(out.blobs[0].verticesAfter).toBeGreaterThan(100);
    });

    it("reports the saving against the RAW source, not the thinned copy", async () => {
      // Otherwise the run's headline number quietly measures the wrong thing.
      const out = await dissolveAlerts([ragged("a")], { ...NO_WAIT, simplifyDeg: 0.01 });

      expect(out.blobs[0].verticesBefore).toBeGreaterThan(200);
    });

    it("still fuses two thinned neighbours", async () => {
      const out = await dissolveAlerts(
        [county("a", "Heat", 3, [0, 0, 1, 1]), county("b", "Heat", 3, [1, 0, 2, 1])],
        { ...NO_WAIT, simplifyDeg: 0.01 },
      );

      expect(out.blobs).toHaveLength(1);
    });

    it("does not drop an area whose shape thinning would destroy", async () => {
      // A county smaller than the tolerance must still be drawn, not vanish.
      const tiny = county("t", "Heat", 3, [0, 0, 0.002, 0.002]);

      const out = await dissolveAlerts([tiny], { ...NO_WAIT, simplifyDeg: 0.01 });

      expect(out.blobs).toHaveLength(1);
      expect(out.blobs[0].memberIds).toEqual(["t"]);
    });
  });

  /**
   * MeteoAlarm ships one `info` block per LANGUAGE, each repeating the same areas
   * with identical polygons. Processing both did every union twice and handed
   * polygon-clipping a polygon plus an exact copy of itself — coincident edges,
   * which it throws on. The swallowed throw turned the duplicate into its own
   * blob, so one Italian region sat in two overlapping blobs at once.
   */
  describe("an alert repeated per language", () => {
    /** The same area, emitted once per language, exactly as MeteoAlarm does it. */
    const bilingual = (id: string, [w, s, e, n]: number[]): iAlert => {
      const area = () => ({
        areaDesc: "Puglia",
        geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
        geocodes: [{ valueName: "EMMA_ID", value: "IT015" }],
      });
      return {
        id,
        maxSeverityRank: 4,
        info: [
          { event: "Heat", severityRank: 4, area: [area()] },
          { event: "Heat", severityRank: 4, area: [area()] },
        ],
      } as unknown as iAlert;
    };

    it("makes ONE blob, not two overlapping ones", async () => {
      const out = await run([bilingual("puglia", [14.9, 39.8, 18.5, 41.9])]);

      expect(out).toHaveLength(1);
      expect(out[0].memberIds).toEqual(["puglia"]);
    });

    it("does not count the duplicate as a union failure", async () => {
      const { unionFailures } = await dissolveAlerts([bilingual("puglia", [14.9, 39.8, 18.5, 41.9])], NO_WAIT);

      expect(unionFailures).toBe(0);
    });

    it("counts the area's vertices once, so the saving isn't inflated", async () => {
      const out = await run([bilingual("puglia", [14.9, 39.8, 18.5, 41.9])]);

      expect(out[0].verticesBefore).toBe(5);
    });

    /**
     * The same trap one level up, and the one that actually bit: a region
     * routinely has TWO live warnings for one hazard (an original and its
     * update), and both resolve their polygon from the same EMMA cache — so the
     * shapes are byte identical. Unioning a polygon with its own copy throws, the
     * throw was swallowed, and the copy became a second blob over the same
     * ground. Live, 33 alerts sat in more than one blob and Puglia was drawn
     * twice.
     */
    it("makes ONE blob when two alerts cover the identical area", async () => {
      const a = county("first", "Heat", 4, [14.9, 39.8, 18.5, 41.9]);
      const b = county("update", "Heat", 4, [14.9, 39.8, 18.5, 41.9]);
      for (const c of [a, b]) c.info[0].area[0].geocodes = [{ valueName: "EMMA_ID", value: "IT015" }];

      const out = await run([a, b]);

      expect(out).toHaveLength(1);
      // Both warnings still ride along — the panel lists them individually.
      expect(out[0].memberIds.sort()).toEqual(["first", "update"]);
    });

    it("does not count an identical twin as a union failure", async () => {
      const a = county("first", "Heat", 4, [14.9, 39.8, 18.5, 41.9]);
      const b = county("update", "Heat", 4, [14.9, 39.8, 18.5, 41.9]);
      for (const c of [a, b]) c.info[0].area[0].geocodes = [{ valueName: "EMMA_ID", value: "IT015" }];

      const { unionFailures } = await dissolveAlerts([a, b], NO_WAIT);

      expect(unionFailures).toBe(0);
    });

    it("still keeps two genuinely different areas of one alert", async () => {
      const two = {
        id: "x",
        maxSeverityRank: 4,
        info: [
          {
            event: "Heat",
            severityRank: 4,
            area: [
              { areaDesc: "A", geocodes: [{ valueName: "EMMA_ID", value: "IT001" }], geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
              { areaDesc: "B", geocodes: [{ valueName: "EMMA_ID", value: "IT002" }], geometry: { type: "Polygon", coordinates: [[[9, 9], [10, 9], [10, 10], [9, 10], [9, 9]]] } },
            ],
          },
        ],
      } as unknown as iAlert;

      expect(await run([two])).toHaveLength(2);
    });
  });

  /**
   * polygon-clipping is synchronous, so a big hazard is minutes of unbroken CPU
   * in a worker that runs ten other jobs. Holding the loop that long starves
   * BullMQ's lock-renewal timer and it drops the locks on all of them — a busy
   * job is indistinguishable from a dead one. So the dissolve must surface.
   */
  describe("yielding", () => {
    const counties = (n: number) =>
      Array.from({ length: n }, (_, i) => county(`c${i}`, "Thunderstorm", 3, [i * 10, 0, i * 10 + 1, 1]));

    it("hands the event loop back as it works", async () => {
      let yields = 0;
      await dissolveAlerts(counties(50), {
        hazardOf,
        yield: async () => void yields++,
        yieldEvery: 10,
      });

      expect(yields).toBe(5);
    });

    it("does not yield mid-union — only between areas", async () => {
      // A yield inside a union would leave a half-built shape visible.
      let yields = 0;
      const out = await dissolveAlerts(counties(4), {
        hazardOf,
        yield: async () => void yields++,
        yieldEvery: 100,
      });

      expect(yields).toBe(0);
      expect(out.blobs).toHaveLength(4);
    });

    it("yields on a schedule that spans buckets, not per bucket", async () => {
      // Ten one-alert hazards must still breathe; per-bucket yields alone left
      // the 750-alert hazards blocking for minutes.
      let yields = 0;
      await dissolveAlerts(
        Array.from({ length: 10 }, (_, i) => county(`c${i}`, `Hazard${i}`, 3, [i * 10, 0, i * 10 + 1, 1])),
        { hazardOf, yield: async () => void yields++, yieldEvery: 2 },
      );

      expect(yields).toBe(5);
    });
  });

  /**
   * Winding is not cosmetic here. Mongo reads a clockwise outer ring as the
   * region's COMPLEMENT, so a reversed blob would both fail to index and answer
   * "which cities are inside this warning" with every city on Earth except the
   * ones actually under it — wrong, and silently so.
   */
  describe("winding", () => {
    const outerRings = (g: { type: string; coordinates: unknown }): Ring[] =>
      g.type === "Polygon"
        ? [(g.coordinates as Ring[])[0]]
        : (g.coordinates as Ring[][]).map((poly) => poly[0]);

    it("winds a dissolved shape's outer ring counter-clockwise", async () => {
      const out = await run([
        county("a", "Thunderstorm", 3, [0, 0, 1, 1]),
        county("b", "Thunderstorm", 3, [1, 0, 2, 1]),
      ]);

      for (const ring of outerRings(out[0].geometry)) expect(signedArea(ring)).toBeGreaterThan(0);
    });

    it("winds every part of a MultiPolygon, not just the first", async () => {
      // A blob is a connected component now, so a MultiPolygon only arrives when
      // a single AREA is one — an archipelago like Croatia's South Dalmatia.
      const islands = {
        id: "hr806",
        maxSeverityRank: 3,
        info: [
          {
            event: "Thunderstorm",
            severityRank: 3,
            area: [
              {
                areaDesc: "South Dalmatia region",
                geocodes: [{ valueName: "EMMA_ID", value: "HR806" }],
                geometry: {
                  type: "MultiPolygon",
                  coordinates: [
                    [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
                    [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
                  ],
                },
              },
            ],
          },
        ],
      } as unknown as iAlert;

      const out = await run([islands]);

      const rings = outerRings(out[0].geometry);
      expect(rings).toHaveLength(2);
      for (const ring of rings) expect(signedArea(ring)).toBeGreaterThan(0);
    });

    it("winds correctly even when the source counties were clockwise", async () => {
      // Sources disagree on winding; a blob must come out right regardless.
      const a = county("a", "Thunderstorm", 3, [0, 0, 1, 1]);
      const b = county("b", "Thunderstorm", 3, [1, 0, 2, 1]);
      for (const c of [a, b]) {
        c.info[0].area[0].geometry!.coordinates[0].reverse();
      }

      const out = await run([a, b]);

      expect(out).toHaveLength(1);
      for (const ring of outerRings(out[0].geometry)) expect(signedArea(ring)).toBeGreaterThan(0);
    });
  });
});
