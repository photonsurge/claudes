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

  it("always drops raw; keeps geometry by default", async () => {
    const spy: { projection?: any } = {};
    await makeAlertsRepo(modelCapturing(spy)).list({ activeOnly: true });
    expect(spy.projection).toEqual({ raw: 0 });
  });

  it("lean also drops the unread description + geocodes (geometry KEPT)", async () => {
    const spy: { projection?: any } = {};
    await makeAlertsRepo(modelCapturing(spy)).list({ activeOnly: true, lean: true });
    expect(spy.projection).toEqual({
      raw: 0,
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
