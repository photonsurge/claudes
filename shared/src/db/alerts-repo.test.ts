import { makeAlertsRepo } from "./alerts-repo";
import { alertContentHash } from "../alerts/content-hash";
import type { iAlert, iAlertInfo } from "./alert-model";

/**
 * `upsert` must not let a routine re-poll wipe the translate job's cached
 * fields off a still-active alert's `info[]` — a Mongo `$set` on an array
 * field replaces it wholesale, and WMO alone re-polls every 10 minutes, long
 * before most bulletins' own content changes.
 */
function baseInfo(overrides: Partial<iAlertInfo> = {}): iAlertInfo {
  return {
    category: [],
    event: "Typhoon",
    severityRank: 4,
    headline: "台风红色预警",
    description: "台风将于今晚登陆",
    instruction: "请立即避难",
    area: [],
    ...overrides,
  };
}

function baseAlert(info: iAlertInfo): iAlert {
  return {
    source: "wmo",
    identifier: "cn-cma-xx/2026/1",
    sender: "cn-cma-xx",
    sent: "2026-07-08T00:00:00.000Z",
    msgType: "Alert",
    status: "Actual",
    references: [],
    info: [info],
    ingestedAt: "2026-07-08T00:00:00.000Z",
    active: true,
    maxSeverityRank: 4,
  } as iAlert;
}

describe("alerts-repo upsert — translation carry-forward", () => {
  it("leaves info untouched when there's no existing doc (first insert)", async () => {
    let captured: any;
    const updateOneImpl = jest.fn((filter: any, update: any) => {
      captured = update;
      return { exec: async () => ({ upsertedCount: 1 }) };
    });
    const model = {
      findOne: () => ({ lean: () => ({ exec: async () => null }) }),
      updateOne: updateOneImpl,
    } as any;
    const repo = makeAlertsRepo(model);
    await repo.upsert(baseAlert(baseInfo()));

    expect(captured.$set.info[0].headline).toBe("台风红色预警");
    expect(captured.$set.info[0].translationHash).toBeUndefined();
  });

  it("carries forward the translation when the content hash still matches", async () => {
    const hash = alertContentHash("台风红色预警", "台风将于今晚登陆", "请立即避难");
    const existing = [
      baseInfo({
        detectedLanguage: "zh",
        translatedHeadline: "Typhoon Red Alert",
        translatedDescription: "Typhoon landing tonight",
        translatedInstruction: "Take shelter immediately",
        translatedAt: "2026-07-08T00:05:00.000Z",
        translationHash: hash,
      }),
    ];
    let captured: any;
    const updateOneImpl = jest.fn((filter: any, update: any) => {
      captured = update;
      return { exec: async () => ({ upsertedCount: 0 }) };
    });
    const model = {
      findOne: () => ({ lean: () => ({ exec: async () => ({ info: existing }) }) }),
      updateOne: updateOneImpl,
    } as any;
    const repo = makeAlertsRepo(model);
    await repo.upsert(baseAlert(baseInfo({ detectedLanguage: undefined, translatedHeadline: undefined, translationHash: undefined })));

    expect(captured.$set.info[0]).toMatchObject({
      detectedLanguage: "zh",
      translatedHeadline: "Typhoon Red Alert",
      translationHash: hash,
    });
  });

  it("does NOT carry forward when the content changed since the last translation", async () => {
    const staleHash = alertContentHash("OLD headline", "OLD description", "OLD instruction");
    const existing = [
      baseInfo({
        headline: "OLD headline",
        description: "OLD description",
        instruction: "OLD instruction",
        detectedLanguage: "zh",
        translatedHeadline: "Old English headline",
        translationHash: staleHash,
      }),
    ];
    let captured: any;
    const updateOneImpl = jest.fn((filter: any, update: any) => {
      captured = update;
      return { exec: async () => ({ upsertedCount: 0 }) };
    });
    const model = {
      findOne: () => ({ lean: () => ({ exec: async () => ({ info: existing }) }) }),
      updateOne: updateOneImpl,
    } as any;
    const repo = makeAlertsRepo(model);
    // Incoming alert has NEW content — a fresh re-poll where the bulletin actually changed.
    await repo.upsert(baseAlert(baseInfo()));

    expect(captured.$set.info[0].translationHash).toBeUndefined();
    expect(captured.$set.info[0].translatedHeadline).toBeUndefined();
    expect(captured.$set.info[0].headline).toBe("台风红色预警");
  });

  it("does NOT carry forward when the existing entry was never translated", async () => {
    const existing = [baseInfo({ translationHash: undefined })];
    let captured: any;
    const updateOneImpl = jest.fn((filter: any, update: any) => {
      captured = update;
      return { exec: async () => ({ upsertedCount: 0 }) };
    });
    const model = {
      findOne: () => ({ lean: () => ({ exec: async () => ({ info: existing }) }) }),
      updateOne: updateOneImpl,
    } as any;
    const repo = makeAlertsRepo(model);
    await repo.upsert(baseAlert(baseInfo()));

    expect(captured.$set.info[0].translationHash).toBeUndefined();
  });
});

describe("alerts-repo upsert — unchanged-alert fast path", () => {
  it("skips the write when the stored alert has the same `sent` and is still active", async () => {
    const updateOne = jest.fn();
    // First findOne is the covered {sent,active} check — return a matching, active head.
    const model = {
      findOne: () => ({ lean: () => ({ exec: async () => ({ sent: "2026-07-08T00:00:00.000Z", active: true }) }) }),
      updateOne,
    } as any;
    const repo = makeAlertsRepo(model);
    const res = await repo.upsert(baseAlert(baseInfo()));

    expect(res.inserted).toBe(false);
    expect(updateOne).not.toHaveBeenCalled(); // no 246KB re-write, no 2dsphere reindex
  });

  it("still writes when the stored alert is inactive (reactivation) even with the same `sent`", async () => {
    const updateOne = jest.fn((_f: any, _u: any) => ({ exec: async () => ({ upsertedCount: 0 }) }));
    const model = {
      findOne: () => ({ lean: () => ({ exec: async () => ({ sent: "2026-07-08T00:00:00.000Z", active: false }) }) }),
      updateOne,
    } as any;
    const repo = makeAlertsRepo(model);
    await repo.upsert(baseAlert(baseInfo()));

    expect(updateOne).toHaveBeenCalled();
  });

  it("still writes when `sent` changed (a genuinely updated bulletin)", async () => {
    const updateOne = jest.fn((_f: any, _u: any) => ({ exec: async () => ({ upsertedCount: 0 }) }));
    const model = {
      findOne: () => ({ lean: () => ({ exec: async () => ({ sent: "2026-07-01T00:00:00.000Z", active: true }) }) }),
      updateOne,
    } as any;
    const repo = makeAlertsRepo(model);
    await repo.upsert(baseAlert(baseInfo())); // baseAlert.sent = 2026-07-08 ≠ stored 2026-07-01

    expect(updateOne).toHaveBeenCalled();
  });
});

describe("alerts-repo list — projection", () => {
  // The list() chain is find().select().sort().limit()[.hint()].lean().exec();
  // capture what select() receives.
  const modelCapturing = (spy: { projection?: unknown }) =>
    ({
      find: () => ({
        select: (p: unknown) => {
          spy.projection = p;
          const tail = {
            sort: () => tail,
            limit: () => tail,
            hint: () => tail,
            lean: () => ({ exec: async () => [] as unknown[] }),
          };
          return tail;
        },
      }),
    }) as any;

  it("always drops raw + the footprint city guide; keeps geometry by default", async () => {
    const spy: { projection?: any } = {};
    await makeAlertsRepo(modelCapturing(spy)).list({ activeOnly: true });
    expect(spy.projection).toEqual({ raw: 0, cities: 0 });
  });

  it("lean also drops the unread description + geocodes (geometry KEPT)", async () => {
    const spy: { projection?: any } = {};
    await makeAlertsRepo(modelCapturing(spy)).list({ activeOnly: true, lean: true });
    expect(spy.projection).toEqual({
      raw: 0,
      cities: 0,
      "info.description": 0,
      "info.area.geocodes": 0,
    });
    // Lean must NOT strip coordinates — the overlay draws the polygon.
    expect(spy.projection["info.area.geometry.coordinates"]).toBeUndefined();
  });

  it("lean composes with omitCoordinates (all pure exclusions)", async () => {
    const spy: { projection?: any } = {};
    await makeAlertsRepo(modelCapturing(spy)).list({ lean: true, omitCoordinates: true });
    expect(spy.projection).toEqual({
      raw: 0,
      cities: 0,
      "info.area.geometry.coordinates": 0,
      "info.description": 0,
      "info.area.geocodes": 0,
    });
  });
});

describe("alerts-repo chain — CAP lifecycle walk", () => {
  const focal = {
    source: "nws",
    identifier: "urn:oid:2.49.0.1.840.0.abc+1",
    references: ["w-nws.webmaster@noaa.gov,urn:oid:2.49.0.1.840.0.prev,2026-07-08T00:00:00Z"],
  };

  it("matches the focal id, the ids it references, and later docs referencing it (regex-escaped)", async () => {
    let capturedQuery: any;
    const model = {
      findOne: () => ({ select: () => ({ lean: () => ({ exec: async () => focal }) }) }),
      find: jest.fn((q: any) => {
        capturedQuery = q;
        return { select: () => ({ sort: () => ({ lean: () => ({ exec: async () => [{ __v: 0, id: "a1" }] }) }) }) };
      }),
    } as any;
    const repo = makeAlertsRepo(model);

    const out = await repo.chain("nws", focal.identifier);

    expect(capturedQuery.source).toBe("nws");
    const [byId, byRef] = capturedQuery.$or;
    // Both the focal identifier and the referenced (superseded) identifier are in the $in.
    expect(byId.identifier.$in).toEqual([focal.identifier, "urn:oid:2.49.0.1.840.0.prev"]);
    // The regex must escape CAP identifiers' special chars (the "+" here).
    expect(byRef.references.$regex).toBe("urn:oid:2\\.49\\.0\\.1\\.840\\.0\\.abc\\+1");
    expect(out).toEqual([{ id: "a1" }]);
  });

  it("returns [] when the focal alert does not exist", async () => {
    const model = {
      findOne: () => ({ select: () => ({ lean: () => ({ exec: async () => null }) }) }),
      find: jest.fn(),
    } as any;
    const repo = makeAlertsRepo(model);
    expect(await repo.chain("nws", "nope")).toEqual([]);
    expect(model.find).not.toHaveBeenCalled();
  });
});

describe("alerts-repo getByKey / listByIds — single-subject reads", () => {
  it("getByKey reads one doc by the (source, identifier) dedup key without raw or the city guide", async () => {
    const spy: { filter?: unknown; projection?: unknown } = {};
    const model = {
      findOne: (f: unknown) => {
        spy.filter = f;
        return {
          select: (p: unknown) => {
            spy.projection = p;
            return { lean: () => ({ exec: async () => ({ __v: 0, id: "a1", source: "nws" }) }) };
          },
        };
      },
    } as any;
    expect(await makeAlertsRepo(model).getByKey("nws", "urn:x")).toEqual({ id: "a1", source: "nws" });
    expect(spy.filter).toEqual({ source: "nws", identifier: "urn:x" });
    expect(spy.projection).toEqual({ raw: 0, cities: 0 });
  });

  it("getByKey is null when there is no such alert", async () => {
    const model = { findOne: () => ({ select: () => ({ lean: () => ({ exec: async () => null }) }) }) } as any;
    expect(await makeAlertsRepo(model).getByKey("nws", "nope")).toBeNull();
  });

  it("listByIds loads whole docs (geometry kept) for the ids, minus raw and the city guide", async () => {
    const spy: { filter?: any; projection?: unknown } = {};
    const model = {
      find: (f: unknown) => {
        spy.filter = f;
        return {
          select: (p: unknown) => {
            spy.projection = p;
            return { lean: () => ({ exec: async () => [{ __v: 0, id: "b" }, { __v: 0, id: "a" }] }) };
          },
        };
      },
    } as any;
    expect(await makeAlertsRepo(model).listByIds(["a", "b"])).toEqual([{ id: "b" }, { id: "a" }]);
    expect(spy.filter).toEqual({ id: { $in: ["a", "b"] } });
    expect(spy.projection).toEqual({ raw: 0, cities: 0 });
  });

  it("listByIds with no ids never queries", async () => {
    const model = { find: jest.fn() } as any;
    expect(await makeAlertsRepo(model).listByIds([])).toEqual([]);
    expect(model.find).not.toHaveBeenCalled();
  });
});

/**
 * `resyncMeteoalarmRanks` exists because fixing the rank RULE fixed nothing that
 * was already stored: `upsert` skips an unchanged, still-active alert, and CAP
 * messages are immutable, so 58% of the live feed kept a rank derived from the
 * very field we'd decided not to trust — indefinitely.
 */
describe("alerts-repo resyncMeteoalarmRanks", () => {
  const mkRepo = (docs: any[]) => {
    const bulkWrite = jest.fn(async () => ({ modifiedCount: docs.length })) as jest.Mock;
    const model = {
      find: () => ({ lean: () => ({ exec: async () => docs }) }),
      bulkWrite,
    } as any;
    return { repo: makeAlertsRepo(model), bulkWrite };
  };

  const doc = (id: string, level: string | null, storedRank: number, sourceSeverity = "Minor") => ({
    id,
    maxSeverityRank: storedRank,
    info: [
      {
        severityRank: storedRank,
        sourceSeverity,
        parameters: level == null ? {} : { awareness_level: level },
      },
    ],
  });

  it("re-ranks a stored green alert down to 0 — the 1,466 that stayed on the globe as Minor", async () => {
    const { repo, bulkWrite } = mkRepo([doc("a", "1; green; Minor", 1)]);
    const r = await repo.resyncMeteoalarmRanks();

    expect(r).toEqual({ scanned: 1, changed: 1 });
    const { filter, update } = (bulkWrite.mock.calls[0][0] as any[])[0].updateOne;
    expect(filter).toEqual({ id: "a" });
    // BOTH ranks: readers sort and bucket on the denormalised one.
    expect(update.$set["info.0.severityRank"]).toBe(0);
    expect(update.$set.maxSeverityRank).toBe(0);
  });

  it("promotes a yellow that CAP called Minor — the rank that never fused with its neighbours", async () => {
    const { repo, bulkWrite } = mkRepo([doc("b", "2; yellow; Moderate", 1)]);
    await repo.resyncMeteoalarmRanks();
    const { update } = (bulkWrite.mock.calls[0][0] as any[])[0].updateOne;
    expect(update.$set["info.0.severityRank"]).toBe(2);
    expect(update.$set.maxSeverityRank).toBe(2);
  });

  it("writes NOTHING when every rank already agrees (so it can run every tick)", async () => {
    const { repo, bulkWrite } = mkRepo([doc("c", "2; yellow; Moderate", 2), doc("d", "1; green; Minor", 0)]);
    const r = await repo.resyncMeteoalarmRanks();
    expect(r).toEqual({ scanned: 2, changed: 0 });
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("is idempotent — re-running over its own output changes nothing", async () => {
    const { repo, bulkWrite } = mkRepo([doc("e", "1; green; Minor", 0)]);
    expect((await repo.resyncMeteoalarmRanks()).changed).toBe(0);
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("leaves an alert with no awareness level alone rather than demoting it to 0", async () => {
    // The guard that matters: falling back to `sourceSeverity` on a doc that
    // hasn't got one reads as rank 0 — a real warning silently becoming
    // "nothing expected".
    const { repo, bulkWrite } = mkRepo([{ id: "f", maxSeverityRank: 3, info: [{ severityRank: 3, parameters: {} }] }]);
    const r = await repo.resyncMeteoalarmRanks();
    expect(r).toEqual({ scanned: 1, changed: 0 });
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("ranks each info entry from its OWN level and maxes across them", async () => {
    const { repo, bulkWrite } = mkRepo([
      {
        id: "g",
        maxSeverityRank: 1,
        info: [
          { severityRank: 1, sourceSeverity: "Minor", parameters: { awareness_level: "1; green; Minor" } },
          { severityRank: 1, sourceSeverity: "Minor", parameters: { awareness_level: "3; orange; Severe" } },
        ],
      },
    ]);
    await repo.resyncMeteoalarmRanks();
    const { update } = (bulkWrite.mock.calls[0][0] as any[])[0].updateOne;
    // Positional, NOT `info.$[]` — that would stamp one rank onto both entries.
    expect(update.$set["info.0.severityRank"]).toBe(0);
    expect(update.$set["info.1.severityRank"]).toBe(3);
    expect(update.$set.maxSeverityRank).toBe(3);
  });
});

/**
 * Green is MeteoAlarm for "no awareness required" — 57% of its feed, each one
 * carrying full EMMA boundary geometry. The parse now drops them on the way in,
 * but MeteoAlarm is NOT a reconcile source (fan-out of ~37 country feeds, any of
 * which can fail transiently), so nothing else would ever retire the 1,546
 * already stored — they'd sit on the globe until they each expired.
 */
describe("alerts-repo deactivateMeteoalarmGreens", () => {
  const mkRepo = (docs: any[]) => {
    const updateMany = jest.fn(() => ({ exec: async () => ({ modifiedCount: 99 }) })) as jest.Mock;
    const model = {
      find: () => ({ lean: () => ({ exec: async () => docs }) }),
      updateMany,
    } as any;
    return { repo: makeAlertsRepo(model), updateMany };
  };

  const info = (level?: string) => ({ parameters: level == null ? {} : { awareness_level: level } });

  it("retires an all-green alert", async () => {
    const { repo, updateMany } = mkRepo([{ id: "g1", info: [info("1; green; Minor"), info("1; green; Minor")] }]);

    const r = await repo.deactivateMeteoalarmGreens();

    expect(r).toEqual({ scanned: 1, deactivated: 99 });
    expect(updateMany.mock.calls[0][0]).toEqual({ id: { $in: ["g1"] } });
    expect(updateMany.mock.calls[0][1]).toEqual({ $set: { active: false } });
  });

  it("keeps a yellow alert", async () => {
    const { repo, updateMany } = mkRepo([{ id: "y1", info: [info("2; yellow; Moderate")] }]);

    expect(await repo.deactivateMeteoalarmGreens()).toEqual({ scanned: 1, deactivated: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("keeps an alert with ANY non-green block — dropping it would bin a real warning", async () => {
    // Doesn't occur live (0 mixed of 2,708), which is exactly why it's pinned:
    // the day it does, this must not quietly delete an orange warning.
    const { repo, updateMany } = mkRepo([{ id: "m1", info: [info("1; green; Minor"), info("3; orange; Severe")] }]);

    expect(await repo.deactivateMeteoalarmGreens()).toEqual({ scanned: 1, deactivated: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("keeps an alert with no awareness level — absence of evidence isn't 'nothing expected'", async () => {
    const { repo, updateMany } = mkRepo([{ id: "n1", info: [info()] }]);

    expect(await repo.deactivateMeteoalarmGreens()).toEqual({ scanned: 1, deactivated: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("retires only the greens out of a mixed batch", async () => {
    const { repo, updateMany } = mkRepo([
      { id: "g1", info: [info("1; green; Minor")] },
      { id: "y1", info: [info("2; yellow; Moderate")] },
      { id: "g2", info: [info("1; green; Minor")] },
      { id: "r1", info: [info("4; red; Extreme")] },
    ]);

    await repo.deactivateMeteoalarmGreens();

    expect(updateMany.mock.calls[0][0]).toEqual({ id: { $in: ["g1", "g2"] } });
  });

  it("writes nothing when there are no greens left (so it can run every tick)", async () => {
    const { repo, updateMany } = mkRepo([{ id: "y1", info: [info("2; yellow; Moderate")] }]);

    expect((await repo.deactivateMeteoalarmGreens()).deactivated).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

/**
 * The scoreboard. Nothing used to report this: the sweep logged how many areas it
 * resolved — effort — while 10,187 of 20,568 areas (49.5%) had no shape and 632
 * MeteoAlarm alerts couldn't be drawn at all. A run could log `resolved: 3` and
 * look like a success on top of a half-blank map.
 */
describe("alerts-repo geometryCoverage", () => {
  const area = (drawn: boolean) => ({ geometry: drawn ? { type: "Polygon" } : undefined });
  const modelOf = (docs: unknown[]) =>
    ({ find: () => ({ lean: () => ({ exec: async () => docs }) }) }) as any;

  it("counts an alert with no drawable area at all as invisible", async () => {
    const m = modelOf([{ info: [{ area: [area(false), area(false)] }] }]);

    const c = await makeAlertsRepo(m).geometryCoverage();

    expect(c).toMatchObject({ alerts: 1, alertsNoShape: 1, alertsPartial: 0, areasNoGeom: 2 });
  });

  it("counts an alert drawing with PIECES MISSING as partial, not fine", async () => {
    // The silent half — it renders, it looks correct on air, and it is wrong.
    const m = modelOf([{ info: [{ area: [area(true), area(false)] }] }]);

    const c = await makeAlertsRepo(m).geometryCoverage();

    expect(c).toMatchObject({ alertsNoShape: 0, alertsPartial: 1, areas: 2, areasNoGeom: 1 });
  });

  it("a fully drawn alert scores clean", async () => {
    const m = modelOf([{ info: [{ area: [area(true), area(true)] }] }]);

    const c = await makeAlertsRepo(m).geometryCoverage();

    expect(c).toMatchObject({ alerts: 1, alertsNoShape: 0, alertsPartial: 0, areasNoGeom: 0 });
  });

  it("ignores an alert with no areas — that's a feed shape, not a geometry gap", async () => {
    // GDACS point alerts carry no area block; counting them as "no location"
    // would bury the MeteoAlarm signal this number exists to expose.
    const m = modelOf([{ info: [{ area: [] }] }, { info: [] }]);

    const c = await makeAlertsRepo(m).geometryCoverage();

    expect(c).toMatchObject({ alerts: 0, alertsNoShape: 0, areas: 0 });
  });

  it("totals across many alerts and info blocks", async () => {
    const m = modelOf([
      { info: [{ area: [area(true)] }, { area: [area(false)] }] },
      { info: [{ area: [area(false)] }] },
    ]);

    const c = await makeAlertsRepo(m).geometryCoverage();

    expect(c).toEqual({ alerts: 2, alertsNoShape: 1, alertsPartial: 1, areas: 3, areasNoGeom: 2 });
  });
});

describe("alerts-repo — name-matched (China/GADM) backfill", () => {
  it("activeAlertsBySender flattens each alert's areas (name + geometry) for the resolver", async () => {
    let filter: any;
    let projection: any;
    const model = {
      find: (f: any, p: any) => {
        filter = f;
        projection = p;
        return {
          lean: () => ({
            exec: async () => [
              {
                identifier: "cma-1",
                info: [
                  { area: [{ areaDesc: "Nanchang", geometry: { type: "Polygon" } }] },
                  { area: [{ areaDesc: "Pingxiang", geometry: null }] },
                ],
              },
            ],
          }),
        };
      },
    } as any;

    const out = await makeAlertsRepo(model).activeAlertsBySender(["cn-cma-xx"]);

    expect(filter).toEqual({ sender: { $in: ["cn-cma-xx"] }, active: true });
    expect(projection).toMatchObject({ identifier: 1, "info.area.areaDesc": 1, "info.area.geometry": 1 });
    expect(out).toEqual([
      {
        identifier: "cma-1",
        areas: [
          { areaDesc: "Nanchang", geometry: { type: "Polygon" } },
          { areaDesc: "Pingxiang", geometry: null },
        ],
      },
    ]);
  });

  it("backfillAreaGeometryByName writes each (identifier, areaDesc) only where geometry is still empty", async () => {
    const bulkWrite = jest.fn(async () => ({ modifiedCount: 1 })) as jest.Mock;
    const model = { bulkWrite } as any;

    const n = await makeAlertsRepo(model).backfillAreaGeometryByName([
      { identifier: "cma-1", areaDesc: "Pingxiang", geometry: { type: "Polygon", coordinates: [] } },
    ]);

    expect(n).toBe(1);
    const { filter, update, arrayFilters } = (bulkWrite.mock.calls[0][0] as any[])[0].updateOne;
    expect(filter).toEqual({ identifier: "cma-1", active: true });
    expect(update.$set["info.$[].area.$[a].geometry"]).toEqual({ type: "Polygon", coordinates: [] });
    // Only the still-empty area of that name — never overwrite one that already draws.
    expect(arrayFilters).toEqual([{ "a.areaDesc": "Pingxiang", "a.geometry": null }]);
  });

  it("backfillAreaGeometryByName is a no-op for no rows", async () => {
    const bulkWrite = jest.fn();
    expect(await makeAlertsRepo({ bulkWrite } as any).backfillAreaGeometryByName([])).toBe(0);
    expect(bulkWrite).not.toHaveBeenCalled();
  });
});

describe("alerts-repo deactivateExpired — global expiry sweep", () => {
  it("deactivates expired active alerts with NO source predicate (reaches orphaned sources)", async () => {
    let filter: any;
    const updateMany = jest.fn((f: any, _u: any) => {
      filter = f;
      return { exec: async () => ({ modifiedCount: 656 }) };
    });
    const repo = makeAlertsRepo({ updateMany } as any);

    const n = await repo.deactivateExpired("2026-07-17T12:00:00.000Z");

    expect(n).toBe(656);
    // The whole point vs. expire(): no `source` key, so a disabled/renamed source's
    // expired alerts are still retired.
    expect(filter.source).toBeUndefined();
    expect(filter.active).toBe(true);
    expect(filter.expiresAt).toEqual({ $ne: null, $lt: "2026-07-17T12:00:00.000Z" });
    expect(updateMany.mock.calls[0][1]).toEqual({ $set: { active: false } });
  });
});

describe("alerts-repo footprintCities — the storm cut's city guide", () => {
  function modelReturning(doc: unknown) {
    const spy: { filter?: any; projection?: any } = {};
    const model = {
      findOne: (filter: any, projection: any) => {
        spy.filter = filter;
        spy.projection = projection;
        return { lean: () => ({ exec: async () => doc }) };
      },
    } as unknown as Parameters<typeof makeAlertsRepo>[0];
    return { model, spy };
  }

  it("matches a storm subject by (source, identifier) and never loads the geometry", async () => {
    const { model, spy } = modelReturning({
      id: "a1",
      source: "meteoalarm",
      identifier: "2.49.0.0.376.0.IL.x",
      cities: [{ id: "tiberias" }],
      cityCount: 1,
      info: [{ area: [{ geometry: { type: "Polygon" } }] }],
    });
    const out = await makeAlertsRepo(model).footprintCities("meteoalarm:2.49.0.0.376.0.IL.x");
    expect(spy.filter.$or[0]).toEqual({ source: "meteoalarm", identifier: "2.49.0.0.376.0.IL.x" });
    expect(spy.projection["info.area.geometry.type"]).toBe(1);
    expect(spy.projection).not.toHaveProperty("info.area.geometry");
    expect(out).toEqual({
      id: "a1",
      source: "meteoalarm",
      identifier: "2.49.0.0.376.0.IL.x",
      cities: [{ id: "tiberias" }],
      cityCount: 1,
      shaped: true,
    });
  });

  it("reports a geocode-only alert as unshaped, and takes a bare id as itself", async () => {
    const { model, spy } = modelReturning({ id: "a2", source: "wmo", identifier: "x", info: [{ area: [{ areaDesc: "Region" }] }] });
    const out = await makeAlertsRepo(model).footprintCities("a2");
    expect(spy.filter.$or).toEqual([{ id: "a2" }, { identifier: "a2" }]);
    expect(out).toMatchObject({ id: "a2", shaped: false });
    expect(out?.cities).toBeUndefined();
  });

  it("is null for an unknown subject", async () => {
    expect(await makeAlertsRepo(modelReturning(null).model).footprintCities("nope")).toBeNull();
  });
});
