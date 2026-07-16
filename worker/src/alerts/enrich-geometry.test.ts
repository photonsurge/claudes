import type { AppDb } from "@photonsurge/shared/db/index";
import type { iAlert } from "@photonsurge/shared/db/alert-model";
import { enrichAreaGeometry } from "./enrich-geometry";

const POLY = { type: "Polygon", coordinates: [[[20, 51], [21, 51], [21, 52], [20, 52], [20, 51]]] };
const OWN = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };

/** A MeteoAlarm-shaped alert: area named + EMMA-coded, no geometry. */
const alertWith = (areas: any[]): iAlert =>
  ({ identifier: "id-1", info: [{ area: areas }] }) as unknown as iAlert;

const fakeDb = (
  cache: Record<string, { geometry: any; precision: "exact" | "bbox" }>,
  admin: Record<string, any> = {},
  names: Record<string, { code: string; geometry: any; centroid?: [number, number] }[]> = {},
) => {
  const calls: string[][] = [];
  const adminCalls: { scheme: string; code: string }[][] = [];
  const nameCalls: { scheme: string; keys: string[] }[] = [];
  const db = {
    alertAreaGeom: {
      async byEmmaIds(ids: string[]) {
        calls.push(ids);
        return new Map(Object.entries(cache).filter(([k]) => ids.includes(k)));
      },
    },
    adminAreaGeom: {
      // Keyed "SCHEME:CODE" (upper-cased) exactly like the real adminKey.
      async byCodes(pairs: { scheme: string; code: string }[]) {
        adminCalls.push(pairs);
        const want = new Set(pairs.map((p) => `${p.scheme.toUpperCase()}:${p.code.toUpperCase()}`));
        return new Map(Object.entries(admin).filter(([k]) => want.has(k)));
      },
      // Keyed by normalised nameKey; a key can map to several candidates.
      async byNameKeys(scheme: string, keys: string[]) {
        nameCalls.push({ scheme, keys });
        return new Map(Object.entries(names).filter(([k]) => keys.includes(k)));
      },
    },
  } as unknown as AppDb;
  return { db, calls, adminCalls, nameCalls };
};

/** A CMA-shaped alert: named areas, no code, no polygon. */
const cmaAlert = (areas: any[]): iAlert =>
  ({ identifier: "cma-1", sender: "cn-cma-xx", info: [{ area: areas }] }) as unknown as iAlert;
const sq = (x: number, y: number): any => ({
  type: "Polygon",
  coordinates: [[[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1], [x - 1, y - 1]]],
});

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

describe("enrichAreaGeometry — static admin (NUTS) codes", () => {
  it("fills a NUTS3 area from the admin cache when it has no EMMA_ID", async () => {
    const { db } = fakeDb({}, { "NUTS3:FR715": POLY });
    const alert = alertWith([
      { areaDesc: "Loire", geometry: null, geocodes: [{ valueName: "NUTS3", value: "FR715" }] },
    ]);

    const res = await enrichAreaGeometry([alert], db);

    expect(alert.info[0].area[0].geometry).toEqual(POLY);
    // GISCO boundaries are the real admin shape: counted exact AND admin.
    expect(res).toMatchObject({ filled: 1, exact: 1, admin: 1, unresolved: 0 });
  });

  it("resolves NUTS2 too (Hungary, Belgium)", async () => {
    const { db } = fakeDb({}, { "NUTS2:HU33": POLY });
    const alert = alertWith([
      { areaDesc: "Dél-Alföld", geometry: null, geocodes: [{ valueName: "NUTS2", value: "HU33" }] },
    ]);

    expect(await enrichAreaGeometry([alert], db)).toMatchObject({ filled: 1, admin: 1 });
  });

  it("prefers EMMA over a NUTS code on the same area", async () => {
    // EMMA is the true warning-area boundary; NUTS is the admin fallback.
    const { db } = fakeDb({ PL1: { geometry: POLY, precision: "exact" } }, { "NUTS3:FR715": OWN });
    const alert = alertWith([
      {
        areaDesc: "both",
        geometry: null,
        geocodes: [{ valueName: "EMMA_ID", value: "PL1" }, { valueName: "NUTS3", value: "FR715" }],
      },
    ]);

    const res = await enrichAreaGeometry([alert], db);

    expect(alert.info[0].area[0].geometry).toEqual(POLY); // EMMA, not the NUTS OWN
    expect(res).toMatchObject({ filled: 1, admin: 0 });
  });

  it("joins case-insensitively (feed casing must not miss the cache)", async () => {
    const { db } = fakeDb({}, { "NUTS3:FR715": POLY });
    const alert = alertWith([
      { areaDesc: "Loire", geometry: null, geocodes: [{ valueName: "nuts3", value: "fr715" }] },
    ]);

    expect(await enrichAreaGeometry([alert], db)).toMatchObject({ filled: 1, admin: 1 });
  });

  it("reports an unresolved NUTS code and drops its null", async () => {
    const { db } = fakeDb({}, {});
    const alert = alertWith([
      { areaDesc: "x", geometry: null, geocodes: [{ valueName: "NUTS3", value: "FR999" }] },
    ]);

    const res = await enrichAreaGeometry([alert], db);

    expect("geometry" in alert.info[0].area[0]).toBe(false);
    expect(res).toMatchObject({ filled: 0, admin: 0, unresolved: 1 });
  });

  it("only queries the admin cache for the codes it actually needs", async () => {
    const { db, adminCalls } = fakeDb({}, { "NUTS3:FR715": POLY });
    const alerts = [
      alertWith([{ areaDesc: "a", geometry: null, geocodes: [{ valueName: "NUTS3", value: "FR715" }] }]),
      alertWith([{ areaDesc: "b", geometry: OWN, geocodes: [{ valueName: "NUTS3", value: "FR716" }] }]), // has own geom
    ];

    await enrichAreaGeometry(alerts, db);

    expect(adminCalls).toHaveLength(1);
    expect(adminCalls[0]).toEqual([{ scheme: "NUTS3", code: "FR715" }]); // FR716 skipped — already drawable
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

describe("enrichAreaGeometry — name-matched (China/GADM) areas", () => {
  it("fills a CMA county area from a unique name match", async () => {
    const { db, nameCalls } = fakeDb({}, {}, { nanchang: [{ code: "CHN.JX.NC", geometry: sq(115, 28) }] });
    const alert = cmaAlert([{ areaDesc: "Nanchang City", geometry: null }]);

    const res = await enrichAreaGeometry([alert], db);

    expect(alert.info[0].area[0].geometry).toEqual(sq(115, 28));
    expect(res).toMatchObject({ filled: 1, exact: 1, named: 1, namedAmbiguous: 0 });
    // Queried once, on the folded name key.
    expect(nameCalls).toEqual([{ scheme: "GADM3", keys: ["nanchang"] }]);
  });

  it("does NOT run the name path for a non-CMA sender", async () => {
    const { db, nameCalls } = fakeDb({}, {}, { nanchang: [{ code: "X", geometry: sq(115, 28) }] });
    const alert = alertWith([{ areaDesc: "Nanchang City", geometry: null, geocodes: [] }]); // no sender

    await enrichAreaGeometry([alert], db);
    expect(nameCalls).toHaveLength(0);
  });

  it("disambiguates a shared county name toward a sibling's own polygon", async () => {
    const { db } = fakeDb(
      {},
      {},
      { pingxiang: [
        { code: "CHN.JX", geometry: sq(113.8, 27.6), centroid: [113.8, 27.6] }, // Jiangxi
        { code: "CHN.GX", geometry: sq(106.6, 22.1), centroid: [106.6, 22.1] }, // Guangxi
      ] },
    );
    // The alert carries a Jiangxi sibling with its own polygon (from the feed).
    const alert = cmaAlert([
      { areaDesc: "Nanchang", geometry: sq(115.9, 28.7) },
      { areaDesc: "Pingxiang City", geometry: null },
    ]);

    const res = await enrichAreaGeometry([alert], db);

    expect(alert.info[0].area[1].geometry).toEqual(sq(113.8, 27.6)); // the Jiangxi Pingxiang
    expect(res).toMatchObject({ named: 1, namedAmbiguous: 1 });
  });

  it("leaves a shared name undrawn when nothing anchors it", async () => {
    const { db } = fakeDb(
      {},
      {},
      { pingxiang: [
        { code: "CHN.JX", geometry: sq(113.8, 27.6), centroid: [113.8, 27.6] },
        { code: "CHN.GX", geometry: sq(106.6, 22.1), centroid: [106.6, 22.1] },
      ] },
    );
    const alert = cmaAlert([{ areaDesc: "Pingxiang City", geometry: null }]);

    const res = await enrichAreaGeometry([alert], db);

    expect("geometry" in alert.info[0].area[0]).toBe(false); // never guessed
    expect(res.named).toBe(0);
  });
});
