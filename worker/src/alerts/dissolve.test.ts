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

  it("tolerates a hair of rounding between two sources' borders", async () => {
    // b starts a whisker past a's edge; without tolerance they'd stay separate.
    const out = await run([county("a", "Thunderstorm", 3, [0, 0, 1, 1]), county("b", "Thunderstorm", 3, [1.001, 0, 2, 1])]);

    expect(out).toHaveLength(1);
  });

  it("emits a MultiPolygon when a cluster genuinely has separate parts", async () => {
    // Two islands close enough to share a bucket but not to touch.
    const out = await run([county("a", "Thunderstorm", 3, [0, 0, 1, 1]), county("b", "Thunderstorm", 3, [1.01, 0, 2, 1])]);
    expect(out[0].geometry.type).toBe("MultiPolygon");
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
      const out = await run([
        county("a", "Thunderstorm", 3, [0, 0, 1, 1]),
        county("b", "Thunderstorm", 3, [1.01, 0, 2, 1]),
      ]);

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
