/** @jest-environment node */

/** /api/admin/presenters — GET bundles catalog, switch, models and samples; PUT saves; DELETE removes; the switch route validates. */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

const mockDb = {
  presenters: { list: jest.fn(), save: jest.fn(), delete: jest.fn() },
  presenterSettings: { get: jest.fn(), save: jest.fn() },
  speechCatalog: { get: jest.fn() },
  eventSummaries: { latest: jest.fn() },
  countryRoundups: { generatedSince: jest.fn() },
  regionRoundups: { generatedSince: jest.fn() },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { DEFAULT_PRESENTER } from "@photonsurge/shared/presenter";
import { DELETE, GET, PUT } from "./route";
import { PUT as PUT_SETTINGS } from "./settings/route";

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.presenters.list.mockResolvedValue([DEFAULT_PRESENTER]);
  mockDb.presenterSettings.get.mockResolvedValue({ enabled: false });
  mockDb.presenterSettings.save.mockImplementation(async (s: unknown) => s);
  mockDb.speechCatalog.get.mockResolvedValue({ models: [], fetchedAt: null });
  mockDb.eventSummaries.latest.mockImplementation(async (p: string) => (p === "hourly" ? { narrative: "Quiet hour." } : null));
  mockDb.countryRoundups.generatedSince.mockResolvedValue([{ name: "Japan", summary: "Typhoon nears.", stateOfPlay: "Rain in Tokyo." }]);
  mockDb.regionRoundups.generatedSince.mockResolvedValue([]);
});

it("GET returns presenters, the switch, the catalog and samples (place: summary + state of play)", async () => {
  const body = await (await GET()).json();
  expect(body.presenters[0].id).toBe("house");
  expect(body.settings).toEqual({ enabled: false });
  expect(body.samples.map((s: { label: string }) => s.label)).toEqual([
    "Latest hourly round-up",
    "Japan round-up (summary + state of play)",
    "Units and numbers",
  ]);
  expect(body.samples[1].text).toBe("Typhoon nears.\n\nRain in Tokyo.");
});

it("PUT saves and rejects a nameless presenter", async () => {
  mockDb.presenters.save.mockImplementation(async (p: { name?: string }) => (p.name ? { ...DEFAULT_PRESENTER, ...p } : null));
  const ok = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ presenter: { name: "Night Desk" } }) }));
  expect(ok.status).toBe(200);
  const bad = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ presenter: { persona: "x" } }) }));
  expect(bad.status).toBe(400);
});

it("DELETE needs an id", async () => {
  expect((await DELETE(new Request("http://x/api/admin/presenters"))).status).toBe(400);
  mockDb.presenters.delete.mockResolvedValue(true);
  expect((await DELETE(new Request("http://x/api/admin/presenters?id=house"))).status).toBe(200);
});

it("the master switch takes a boolean only", async () => {
  const on = await PUT_SETTINGS(new Request("http://x", { method: "PUT", body: JSON.stringify({ enabled: true }) }));
  expect((await on.json()).settings).toEqual({ enabled: true });
  const bad = await PUT_SETTINGS(new Request("http://x", { method: "PUT", body: JSON.stringify({ enabled: "yes" }) }));
  expect(bad.status).toBe(400);
});
