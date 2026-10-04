/** @jest-environment node */

/**
 * /api/admin/roundup-settings — GET carries the settings + the global
 * round-ups' last runs; PUT overlays only the ids sent onto the STORED
 * settings (two pages edit different rows) and rejects a body with no settings.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

const mockDb = {
  roundupSettings: { get: jest.fn(), save: jest.fn() },
  eventSummaries: { latest: jest.fn() },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { DEFAULT_ROUNDUP_SETTINGS } from "@photonsurge/shared/roundup-settings";
import { GET, PUT } from "./route";

const put = (body: unknown) =>
  PUT(new Request("http://x/api/admin/roundup-settings", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.roundupSettings.get.mockResolvedValue(DEFAULT_ROUNDUP_SETTINGS);
  mockDb.roundupSettings.save.mockImplementation(async (s: unknown) => s);
});

it("GET returns settings and last runs for the global ids only", async () => {
  mockDb.eventSummaries.latest.mockImplementation(async (p: string) =>
    p === "hourly" ? { generatedAt: new Date("2026-10-04T13:00:00Z") } : null,
  );
  const body = await (await GET()).json();
  expect(body.settings).toEqual(DEFAULT_ROUNDUP_SETTINGS);
  expect(body.lastRun).toEqual({ "global-hourly": "2026-10-04T13:00:00.000Z", "global-12h": null, "global-daily": null });
});

it("PUT overlays the provided ids on the stored settings", async () => {
  const stored = { ...DEFAULT_ROUNDUP_SETTINGS, "place-country": { enabled: false, hours: [3] } };
  mockDb.roundupSettings.get.mockResolvedValue(stored);
  const res = await put({ settings: { "global-daily": { enabled: true, hours: [5] }, bogus: { enabled: true, hours: [1] } } });
  expect(res.status).toBe(200);
  const saved = mockDb.roundupSettings.save.mock.calls[0][0];
  expect(saved["global-daily"]).toEqual({ enabled: true, hours: [5] });
  expect(saved["place-country"]).toEqual({ enabled: false, hours: [3] });
  expect(saved.bogus).toBeUndefined();
  expect((await res.json()).ok).toBe(true);
});

it("PUT rejects a missing or non-object settings", async () => {
  for (const b of [{}, { settings: "x" }, { settings: [1] }, null]) {
    expect((await put(b)).status).toBe(400);
  }
  expect(mockDb.roundupSettings.save).not.toHaveBeenCalled();
});
