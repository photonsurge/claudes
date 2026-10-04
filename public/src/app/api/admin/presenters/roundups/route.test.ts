/** @jest-environment node */

/** /api/admin/presenters/roundups — world round-ups first, then latest per country and region; empty ones dropped. */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

const mockDb = {
  eventSummaries: { list: jest.fn() },
  countryRoundups: { latestPerPlace: jest.fn() },
  regionRoundups: { latestPerPlace: jest.fn() },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { GET } from "./route";

it("lists world, country and region round-ups with the text a presenter reads", async () => {
  const at = new Date("2026-10-04T21:00:00Z");
  mockDb.eventSummaries.list.mockResolvedValue([
    { id: "s1", period: "hourly", generatedAt: at, narrative: "A quiet hour." },
    { id: "s2", period: "daily", generatedAt: at, narrative: "" },
  ]);
  mockDb.countryRoundups.latestPerPlace.mockResolvedValue([
    { id: "c1", placeKind: "country", placeId: "JP", name: "Japan", generatedAt: at, narrative: "x", summary: "Typhoon nears.", stateOfPlay: "Rain in Tokyo." },
  ]);
  mockDb.regionRoundups.latestPerPlace.mockResolvedValue([
    { id: "r1", placeKind: "region", placeId: "europe", name: "Europe", generatedAt: at, narrative: "Settled." },
  ]);
  const { items } = await (await GET()).json();
  expect(items.map((i: { group: string; label: string }) => `${i.group}|${i.label}`)).toEqual([
    "World|World hourly · 2026-10-04 21:00 UTC",
    "Countries|Japan · 2026-10-04 21:00 UTC",
    "Regions|Europe · 2026-10-04 21:00 UTC",
  ]);
  expect(items[1].text).toBe("Typhoon nears.\n\nRain in Tokyo.");
  expect(items[2].text).toBe("Settled.");
});
