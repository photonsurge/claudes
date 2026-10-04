jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogErr: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("../summaries/aggregate", () => ({ aggregate: jest.fn() }));
jest.mock("../summaries/areaContext", () => ({ buildAreaContext: jest.fn(async () => ({ areaWeather: [], placeHeadlines: [] })) }));
jest.mock("../summaries/openrouter", () => ({
  generateNarrative: jest.fn(async () => ({ narrative: "snapshot", status: "ok" })),
  summaryTrend: jest.fn(() => null),
}));
jest.mock("../summaries/rollup", () => ({ generate12hRollup: jest.fn(async () => ({ narrative: "rollup", status: "ok" })) }));

import { getAppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_ROUNDUP_SETTINGS } from "@photonsurge/shared/roundup-settings";
import { aggregate } from "../summaries/aggregate";
import { generateNarrative } from "../summaries/openrouter";
import { generate12hRollup } from "../summaries/rollup";
import { tick, generate12h } from "./summaries";

const NOW = new Date("2026-07-11T00:05:00Z"); // every default slot open

function fakeDb(opts: { latest?: Record<string, Date>; hourlies?: Date[]; failCreate?: string[] } = {}) {
  const created: string[] = [];
  const db = {
    roundupSettings: { get: jest.fn(async () => DEFAULT_ROUNDUP_SETTINGS) },
    eventSummaries: {
      latest: jest.fn(async (p: string) => (opts.latest?.[p] ? { generatedAt: opts.latest[p], narrative: "prev" } : null)),
      list: jest.fn(async () => (opts.hourlies ?? []).map((generatedAt) => ({ generatedAt }))),
      create: jest.fn(async (doc: { period: string }) => {
        if (opts.failCreate?.includes(doc.period)) throw new Error(`create ${doc.period} failed`);
        created.push(doc.period);
        return { id: `id-${doc.period}` };
      }),
    },
  };
  (getAppDb as jest.Mock).mockResolvedValue(db);
  return { db, created };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
  jest.clearAllMocks();
  (aggregate as jest.Mock).mockImplementation(async () => ({
    windowStart: NOW,
    windowEnd: NOW,
    stats: { alertsActive: 0, quakeCount: 0 },
    hotspots: [],
    topEvents: [],
    sources: [],
  }));
});
afterEach(() => jest.useRealTimers());

describe("summaries.tick", () => {
  it("writes every due period in order hourly → 12h → daily", async () => {
    const { created } = fakeDb();
    const result = await tick({} as any);
    expect(created).toEqual(["hourly", "12h", "daily"]);
    expect(result).toEqual({ ran: ["hourly", "12h", "daily"], failed: [], skipped: {} });
  });

  it("skips periods whose slot is already served", async () => {
    const { created } = fakeDb({ latest: { "12h": new Date("2026-07-11T00:01:00Z"), daily: new Date("2026-07-11T00:01:00Z") } });
    const result = await tick({} as any);
    expect(created).toEqual(["hourly"]);
    expect(result.skipped).toEqual({ "12h": "not-due", daily: "not-due" });
  });

  it("attempts every period, then rethrows the first failure", async () => {
    const { created } = fakeDb({ failCreate: ["hourly", "daily"] });
    await expect(tick({} as any)).rejects.toThrow("create hourly failed");
    expect(created).toEqual(["12h"]); // the 12h still ran after the hourly failed
  });
});

describe("12h round-up window", () => {
  it("rolls up only the hourlies from the last 12 hours", async () => {
    fakeDb({ hourlies: [new Date("2026-07-10T23:05:00Z"), new Date("2026-07-10T11:00:00Z")] });
    await generate12h({} as any);
    const hourlies = (generate12hRollup as jest.Mock).mock.calls[0][0];
    expect(hourlies).toHaveLength(1);
    expect(generateNarrative).not.toHaveBeenCalled();
  });

  it("narrates the snapshot when no hourly was written in the window", async () => {
    fakeDb({ hourlies: [new Date("2026-07-09T12:00:00Z")] });
    await generate12h({} as any);
    expect(generate12hRollup).not.toHaveBeenCalled();
    expect((generateNarrative as jest.Mock).mock.calls[0][1]).toBe("12h");
  });
});
