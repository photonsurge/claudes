import type { AppDb } from "@photonsurge/shared/db/index";
import type { iAlert } from "@photonsurge/shared/db/alert-model";
import { enrichAreaGeometry } from "./enrich-geometry";

const POLY = { type: "Polygon", coordinates: [[[20, 51], [21, 51], [21, 52], [20, 52], [20, 51]]] };
const OWN = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };

/** A MeteoAlarm-shaped alert: area named + EMMA-coded, no geometry. */
const alertWith = (areas: any[]): iAlert =>
  ({ identifier: "id-1", info: [{ area: areas }] }) as unknown as iAlert;

const fakeDb = (cache: Record<string, { geometry: any; precision: "exact" | "bbox" }>) => {
  const calls: string[][] = [];
  const db = {
    alertAreaGeom: {
      async byEmmaIds(ids: string[]) {
        calls.push(ids);
        return new Map(Object.entries(cache).filter(([k]) => ids.includes(k)));
      },
    },
  } as unknown as AppDb;
  return { db, calls };
};

describe("enrichAreaGeometry", () => {
  it("gives a geocode-only area the cached boundary for its EMMA_ID", async () => {
    const { db } = fakeDb({ PL2406: { geometry: POLY, precision: "exact" } });
    const alert = alertWith([
      { areaDesc: "powiat kłobucki", geometry: null, geocodes: [{ valueName: "EMMA_ID", value: "PL2406" }] },
    ]);

    const res = await enrichAreaGeometry([alert], db);

    expect(alert.info[0].area[0].geometry).toEqual(POLY);
    expect(res).toMatchObject({ filled: 1, exact: 1, unresolved: 0 });
  });

  it("counts a bbox hit as filled but not exact", async () => {
    const { db } = fakeDb({ PL2406: { geometry: POLY, precision: "bbox" } });
    const alert = alertWith([
      { areaDesc: "a", geometry: null, geocodes: [{ valueName: "EMMA_ID", value: "PL2406" }] },
    ]);

    expect(await enrichAreaGeometry([alert], db)).toMatchObject({ filled: 1, exact: 0 });
  });

  it("never overwrites geometry the source already provided", async () => {
    const { db } = fakeDb({ PL2406: { geometry: POLY, precision: "exact" } });
    const alert = alertWith([
      { areaDesc: "a", geometry: OWN, geocodes: [{ valueName: "EMMA_ID", value: "PL2406" }] },
    ]);

    const res = await enrichAreaGeometry([alert], db);

    expect(alert.info[0].area[0].geometry).toEqual(OWN);
    expect(res.filled).toBe(0);
  });

  it("leaves an unresolved area alone and reports it", async () => {
    const { db } = fakeDb({ PL2406: { geometry: POLY, precision: "exact" } });
    const alert = alertWith([
      { areaDesc: "a", geometry: null, geocodes: [{ valueName: "EMMA_ID", value: "XX9999" }] },
    ]);

    const res = await enrichAreaGeometry([alert], db);

    // Left undrawable, and the null is dropped rather than kept (see the
    // "partial alerts must stay indexable" cases below).
    expect(alert.info[0].area[0].geometry).toBeUndefined();
    expect(res).toMatchObject({ filled: 0, unresolved: 1 });
  });

  it("looks the whole tick up in ONE batched query, not one per area", async () => {
    const { db, calls } = fakeDb({ PL1: { geometry: POLY, precision: "exact" } });
    const alerts = [
      alertWith([{ areaDesc: "a", geometry: null, geocodes: [{ valueName: "EMMA_ID", value: "PL1" }] }]),
      alertWith([{ areaDesc: "b", geometry: null, geocodes: [{ valueName: "EMMA_ID", value: "PL2" }] }]),
    ];

    await enrichAreaGeometry(alerts, db);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["PL1", "PL2"]);
  });

  it("does not query at all when nothing needs geometry", async () => {
    const { db, calls } = fakeDb({});
    const alert = alertWith([{ areaDesc: "a", geometry: OWN, geocodes: [] }]);

    expect(await enrichAreaGeometry([alert], db)).toMatchObject({ filled: 0 });
    expect(calls).toHaveLength(0);
  });

  it("ignores non-EMMA geocodes (UGC/FIPS feeds have nothing to join on)", async () => {
    const { db, calls } = fakeDb({ PL2406: { geometry: POLY, precision: "exact" } });
    const alert = alertWith([
      { areaDesc: "a", geometry: null, geocodes: [{ valueName: "UGC", value: "PL2406" }] },
    ]);

    await enrichAreaGeometry([alert], db);
    expect(calls).toHaveLength(0);
  });
});

describe("enrichAreaGeometry — partial alerts must stay indexable", () => {
  it("drops the null geometry of areas it could not resolve", async () => {
    // A Spanish alert has ~100 areas and the cache fills a few at a time. Mongo's
    // 2dsphere is sparse per DOC: once ONE area has a geometry the doc is indexed
    // and every element is read, so a sibling `geometry: null` rejects the write —
    // ingest then strips ALL geometry and we lose the one we just resolved.
    const { db } = fakeDb({ PL1: { geometry: POLY, precision: "exact" } });
    const alert = alertWith([
      { areaDesc: "resolved", geometry: null, geocodes: [{ valueName: "EMMA_ID", value: "PL1" }] },
      { areaDesc: "not yet", geometry: null, geocodes: [{ valueName: "EMMA_ID", value: "PL2" }] },
    ]);

    await enrichAreaGeometry([alert], db);

    expect(alert.info[0].area[0].geometry).toEqual(POLY);
    // Absent, NOT null — that's the whole point.
    expect("geometry" in alert.info[0].area[1]).toBe(false);
  });

  it("leaves a source's own geometry alone while dropping nulls beside it", async () => {
    const { db } = fakeDb({});
    const alert = alertWith([
      { areaDesc: "has its own", geometry: OWN, geocodes: [] },
      { areaDesc: "none", geometry: null, geocodes: [{ valueName: "EMMA_ID", value: "PL9" }] },
    ]);

    await enrichAreaGeometry([alert], db);

    expect(alert.info[0].area[0].geometry).toEqual(OWN);
    expect("geometry" in alert.info[0].area[1]).toBe(false);
  });
});
