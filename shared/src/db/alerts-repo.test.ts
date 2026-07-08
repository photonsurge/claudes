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
