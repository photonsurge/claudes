// The single-place round-up entry the render queue's `refresh` uses (§8).
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("../director/fresh", () => ({ freshEvents: { nudge: jest.fn() } }));
jest.mock("./aggregate", () => ({
  WINDOW_HOURS: 12,
  buildPlaceInputs: jest.fn(async () => ({ topCities: [{}], alerts: [], volcanoes: [] })),
}));
jest.mock("./openrouter", () => ({ generatePlaceNarrative: jest.fn() }));

import { emitWorkerEvent } from "../socket";
import { buildPlaceInputs } from "./aggregate";
import { generatePlaceNarrative } from "./openrouter";
import { refreshPlaceRoundup } from "./refresh";

const repo = () => ({ latestForPlace: jest.fn(async () => ({ id: "prev" })), create: jest.fn(async (d: any) => ({ ...d, id: "new" })) });
const makeDb = () =>
  ({
    countries: { get: jest.fn(async (id: string) => (id === "gb" ? { countryId: "gb", name: "United Kingdom", bbox: [-8, 49, 2, 61], iso2: "GB", capital: "London" } : null)) },
    regions: { get: jest.fn(async (id: string) => (id === "europe" ? { regionId: "europe", name: "Europe", bbox: [-25, 34, 45, 72] } : null)) },
    countryRoundups: repo(),
    regionRoundups: repo(),
  }) as any;

const ok = { status: "ok", narrative: "n", summary: "s", stateOfPlay: "", cityOutlook: [], advice: "" };

beforeEach(() => jest.clearAllMocks());

it("writes a country's round-up now, by its ISO code, and announces it", async () => {
  (generatePlaceNarrative as jest.Mock).mockResolvedValue(ok);
  const db = makeDb();
  const res = await refreshPlaceRoundup(db, { type: "country", id: "uk" });
  expect(res).toMatchObject({ id: "new", place: "United Kingdom", narrativeStatus: "ok" });
  expect(buildPlaceInputs).toHaveBeenCalledWith(db, expect.objectContaining({ kind: "country", id: "gb", iso2: "GB" }));
  expect(db.countryRoundups.create).toHaveBeenCalledWith(expect.objectContaining({ placeKind: "country", placeId: "gb", prevRoundupId: "prev", summary: "s" }));
  expect(emitWorkerEvent).toHaveBeenCalledWith(expect.objectContaining({ data: { placeKind: "country", placeId: "gb", id: "new" } }));
});

it("writes an area's round-up by its region id", async () => {
  (generatePlaceNarrative as jest.Mock).mockResolvedValue(ok);
  const db = makeDb();
  await refreshPlaceRoundup(db, { type: "area", id: "europe" });
  expect(db.regionRoundups.create).toHaveBeenCalledWith(expect.objectContaining({ placeKind: "region", placeId: "europe" }));
});

it("throws a readable reason for an unknown place, or when no narrative came back", async () => {
  const db = makeDb();
  await expect(refreshPlaceRoundup(db, { type: "country", id: "atlantis" })).rejects.toThrow(/unknown country id "atlantis"/);
  await expect(refreshPlaceRoundup(db, { type: "area", id: "nowhere" })).rejects.toThrow(/no region record for "nowhere"/);
  (generatePlaceNarrative as jest.Mock).mockResolvedValue({ status: "skipped" });
  await expect(refreshPlaceRoundup(db, { type: "area", id: "europe" })).rejects.toThrow("the refreshed round-up for Europe has no narrative (skipped)");
});
