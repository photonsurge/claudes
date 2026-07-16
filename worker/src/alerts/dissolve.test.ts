import type { AlertGeometry, iAlert } from "@photonsurge/shared/db/alert-model";
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
   * Thinning cheapens the shape the globe finally draws — but it happens AFTER
   * the clip, and the order is the whole point. See the regression block below
   * for what thinning the INPUTS did to real borders.
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

    it("thins the shape it stores", async () => {
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

    it("does not drop an area whose shape thinning would destroy", async () => {
      // A county smaller than the tolerance must still be drawn, not vanish.
      const tiny = county("t", "Heat", 3, [0, 0, 0.002, 0.002]);

      const out = await dissolveAlerts([tiny], { ...NO_WAIT, simplifyDeg: 0.01 });

      expect(out.blobs).toHaveLength(1);
      expect(out.blobs[0].memberIds).toEqual(["t"]);
    });
  });

  /**
   * Adjacency is transitive and weather doesn't stop at borders, so without a
   * national seam the chain ran clean across the continent. Live: ONE thunderstorm
   * blob of 206 alerts spanning thirteen countries from Spain to Kosovo, one heat
   * blob from Spain to the Netherlands, one storm blob across 100° of longitude
   * from Kazakhstan to the Pacific.
   *
   * Those shapes aren't wrong so much as useless — a blob carries ONE
   * representative alert card, so clicking a third of Europe quoted one country's
   * headline for all of it. A warning is issued BY a country, so that's where the
   * editorial actually changes, and that's the seam.
   */
  describe("a blob never crosses a national border", () => {
    /** A county warning that knows where it is, the way a real CAP alert does. */
    const ccCounty = (id: string, cc: string, box: number[], event = "Heat"): iAlert => {
      const a = county(id, event, 3, box);
      (a as unknown as { source: string }).source = "meteoalarm";
      (a as unknown as { identifier: string }).identifier = `2.49.0.0.${cc}.20260716`;
      return a;
    };

    it("keeps two touching counties apart when they're in different countries", async () => {
      // Physically adjacent, same hazard, same severity — everything the dissolve
      // used to need to fuse them. Different met services, so: two shapes.
      const out = await run([ccCounty("fr", "FR", [0, 0, 1, 1]), ccCounty("es", "ES", [1, 0, 2, 1])]);

      expect(out).toHaveLength(2);
      expect(out.map((b) => b.country).sort()).toEqual(["ES", "FR"]);
    });

    it("still fuses touching counties WITHIN a country", async () => {
      // The whole point survives: Poland's ~550 county alerts must not come back
      // as confetti just because we added a border rule.
      const out = await run([ccCounty("pl1", "PL", [0, 0, 1, 1]), ccCounty("pl2", "PL", [1, 0, 2, 1])]);

      expect(out).toHaveLength(1);
      expect(out[0].country).toBe("PL");
      expect(out[0].memberIds.sort()).toEqual(["pl1", "pl2"]);
    });

    it("does not chain a run of counties across three countries", async () => {
      // The Spain->Kosovo shape, in miniature.
      const out = await run([
        ccCounty("a", "FR", [0, 0, 1, 1]),
        ccCounty("b", "DE", [1, 0, 2, 1]),
        ccCounty("c", "PL", [2, 0, 3, 1]),
      ]);

      expect(out).toHaveLength(3);
    });

    it("labels the blob with the country its members share", async () => {
      const out = await run([ccCounty("es1", "ES", [0, 0, 1, 1]), ccCounty("es2", "ES", [1, 0, 2, 1])]);

      // So a card can say "Spain: amber heat" and be telling the truth.
      expect(out[0].country).toBe("ES");
    });

    it("still splits by hazard and severity inside one country", async () => {
      const out = await run([
        ccCounty("a", "FR", [0, 0, 1, 1], "Heat"),
        ccCounty("b", "FR", [1, 0, 2, 1], "Flood"),
      ]);

      expect(out).toHaveLength(2);
    });

    it("leaves the country off a feed that doesn't carry one", async () => {
      // GDACS is a global feed with no country in the identifier; it must still
      // dissolve, just without claiming a nationality it doesn't know.
      const g = county("gdacs-1", "Flood", 3, [0, 0, 1, 1]);
      (g as unknown as { source: string }).source = "gdacs";
      (g as unknown as { identifier: string }).identifier = "GDACS-FL-12345";

      const out = await run([g]);

      expect(out).toHaveLength(1);
      expect(out[0].country).toBeUndefined();
    });

    it("decodes the country for every feed shape, not just meteoalarm", async () => {
      // WMO puts it in the capurl lead, NWS is US by definition. If any of these
      // regress to undefined they all bucket together and Europe re-fuses.
      const wmo = county("ru", "Wind", 2, [30, 50, 31, 51]);
      (wmo as unknown as { source: string }).source = "wmo";
      (wmo as unknown as { identifier: string }).identifier = "ru-meteo-en/2026/07/16/x.xml";
      const nws = county("us", "Wind", 2, [-80, 40, -79, 41]);
      (nws as unknown as { source: string }).source = "nws";
      (nws as unknown as { identifier: string }).identifier = "urn:oid:2.49.0.1.840.0.abc";

      const out = await run([wmo, nws]);

      expect(out.map((b) => b.country).sort()).toEqual(["RU", "US"]);
    });
  });

  /**
   * The dissolve only ever merged areas AGAINST EACH OTHER, which is a complete
   * no-op when a bucket holds one area — and WMO routinely ships an entire country
   * as exactly that: ONE alert, ONE area, one multi-part geometry. Moldova arrived
   * as 1 alert / 1 area / 36 county polygons; a US heat advisory as ~30, its
   * areaDesc a semicolon-joined list of every county. Nothing to union against, so
   * every part passed through untouched and the globe drew a county lattice across
   * a shape that was supposed to be one place. The merge simply never ran for them.
   */
  describe("a country shipped as ONE multi-part area", () => {
    /** One alert, one area, `parts` separate county polygons — the WMO shape. */
    const multiPartCountry = (boxes: number[][]): iAlert =>
      ({
        id: "wmo-1",
        source: "wmo",
        identifier: "md-meteo-en/2026/07/16/x.xml",
        maxSeverityRank: 2,
        info: [
          {
            event: "Forest Fire",
            severityRank: 2,
            area: [
              {
                areaDesc: boxes.map((_, i) => `County ${i}`).join("; "),
                geometry: {
                  type: "MultiPolygon",
                  coordinates: boxes.map(([w, s, e, n]) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]]),
                },
              },
            ],
          },
        ],
      }) as unknown as iAlert;

    it("fuses the counties inside a single area into one shape", async () => {
      // Three touching counties in ONE area. Before: three outlines drawn, no
      // union attempted at all.
      const out = await run([multiPartCountry([[0, 0, 1, 1], [1, 0, 2, 1], [2, 0, 3, 1]])]);

      expect(out).toHaveLength(1);
      expect(out[0].geometry.type).toBe("Polygon"); // one part, not three
    });

    it("leaves no internal borders — that is what the lines were", async () => {
      const out = await run([multiPartCountry([[0, 0, 1, 1], [1, 0, 2, 1]])]);

      // Two squares fused across x=1 => a single 5-point ring, not two rings.
      const coords = out[0].geometry.coordinates as unknown as number[][][];
      expect(coords).toHaveLength(1);
      expect(coords[0].length).toBeLessThanOrEqual(5);
    });

    it("still keeps genuinely separate parts apart (the Sicily rule)", async () => {
      // An island in the same area must not fuse to the mainland just because it
      // arrived in the same geometry.
      const out = await run([multiPartCountry([[0, 0, 1, 1], [1, 0, 2, 1], [50, 50, 51, 51]])]);

      expect(out).toHaveLength(2);
    });

    it("keeps the member alert on every shape it produced", async () => {
      // The parts share one alert; splitting the geography must not lose it.
      const out = await run([multiPartCountry([[0, 0, 1, 1], [50, 50, 51, 51]])]);

      for (const b of out) expect(b.memberIds).toEqual(["wmo-1"]);
    });

    it("counts the source vertices once, not once per part", async () => {
      // `before` is charged per part from the raw source. Summed across the
      // blobs it must equal the area's real vertex count, or the run's headline
      // saving is inflated by however many parts the source happened to use.
      const boxes = [[0, 0, 1, 1], [50, 50, 51, 51]];
      const out = await run([multiPartCountry(boxes)]);

      const total = out.reduce((n, b) => n + b.verticesBefore, 0);
      expect(total).toBe(10); // two 5-point rings
    });
  });

  /**
   * REAL geometry, because nothing else reproduces this.
   *
   * Thinning used to happen to the INPUTS, before the clip, on the theory that the
   * overlay coarsens the result to ~5km anyway so the detail was being clipped and
   * thrown away. It bought a lot: 91% fewer vertices, 40s -> 3s, peak heap 711MB
   * -> 289MB. It also quietly broke the thing this whole function exists to do.
   *
   * Douglas-Peucker chooses which points to keep from each ring's OWN shape, so
   * two neighbours thin their SHARED border differently and it stops being shared.
   * polygon-clipping then answers the union of Flevoland and Friesland with FIVE
   * disjoint parts instead of one merged shape; the part-count test reads that as
   * "these don't touch" and leaves them apart, and the globe draws a seam down a
   * border that doesn't exist. Live, 63 pairs of genuinely-touching regions —
   * Dutch provinces, Veneto/Friuli, the Graz districts — stopped fusing.
   *
   * The unit test that was supposed to cover this fused two perfect SQUARES, and a
   * 5-point square survives Douglas-Peucker untouched: it asserted fusing on
   * geometry that was never thinned, and passed all the way through the bug. Hence
   * real provinces here — the shapes have the ragged shared borders that squares
   * don't.
   */
  describe("thinning must not break a shared border", () => {
    const provinces = require("./__fixtures__/nl-touching-provinces.json") as Record<string, AlertGeometry>;

    const province = (name: string, rank = 3): iAlert =>
      ({
        id: name,
        maxSeverityRank: rank,
        info: [{ event: "Heat", severityRank: rank, area: [{ areaDesc: name, geometry: provinces[name] }] }],
      }) as unknown as iAlert;

    it("fuses two provinces that really share a border", async () => {
      const out = await dissolveAlerts([province("Flevoland"), province("Friesland")], {
        ...NO_WAIT,
        simplifyDeg: 0.002,
      });

      expect(out.blobs).toHaveLength(1);
      expect(out.blobs[0].memberIds.sort()).toEqual(["Flevoland", "Friesland"]);
    });

    it("fuses a chain of three provinces into one shape", async () => {
      const out = await dissolveAlerts(
        [province("Flevoland"), province("Friesland"), province("Overijssel")],
        { ...NO_WAIT, simplifyDeg: 0.002 },
      );

      expect(out.blobs).toHaveLength(1);
      expect(out.blobs[0].memberIds.sort()).toEqual(["Flevoland", "Friesland", "Overijssel"]);
    });

    it("reports no union failure fusing them", async () => {
      const out = await dissolveAlerts([province("Flevoland"), province("Friesland")], {
        ...NO_WAIT,
        simplifyDeg: 0.002,
      });

      expect(out.unionFailures).toBe(0);
    });

    it("still thins the fused outline it stores", async () => {
      // The saving has to survive the fix, or we've traded the seam for the RAM.
      const out = await dissolveAlerts([province("Flevoland"), province("Friesland")], {
        ...NO_WAIT,
        simplifyDeg: 0.002,
      });

      expect(out.blobs[0].verticesAfter).toBeLessThan(out.blobs[0].verticesBefore);
    });

    it("fuses them at every tolerance the job might be run at", async () => {
      // The old code fused these at 0 and broke somewhere under 0.002. Pin the
      // whole range so a future tuning of the number can't quietly reintroduce it.
      for (const simplifyDeg of [0, 0.002, 0.01, 0.05]) {
        const out = await dissolveAlerts([province("Flevoland"), province("Friesland")], {
          ...NO_WAIT,
          simplifyDeg,
        });

        expect([simplifyDeg, out.blobs.length]).toEqual([simplifyDeg, 1]);
      }
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

      // Two islands 5° apart, so they are two SHAPES — the parts of one area are
      // dissolved like any other geography, and disjoint things never fuse (the
      // Sicily rule). What matters here is that every ring came out wound right,
      // whichever blob it landed in.
      const rings = out.flatMap((b) => outerRings(b.geometry));
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
