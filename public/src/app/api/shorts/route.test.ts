/** @jest-environment node */

/**
 * GET /api/shorts — the /admin/shorts snapshot: light script rows (created
 * time joined in, the play on its format's scene without its clip schedule) +
 * every format with its scene's state.
 */
jest.mock("../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = {
  shortScripts: {
    list: jest.fn(),
    model: { find: jest.fn() },
  },
  shortFormats: { list: jest.fn() },
  getScene: jest.fn(),
  getOrInitDirectorConfig: jest.fn(),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../lib/require-admin";
import { GET } from "./route";

const clip = (id: string, durationMs: number) => ({ id, target: `country:${id}`, durationMs, label: { title: id } });
const play = {
  sceneId: "shorts",
  playNonce: 7,
  startedAt: 1000,
  endedAt: 5000,
  clips: [{ id: "a", startMs: 0, durationMs: 20_000 }],
  skipped: [{ id: "b", reason: "alert expired" }],
};

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
  mockDb.shortFormats.list.mockResolvedValue([]);
  mockDb.shortScripts.model.find.mockReturnValue({
    lean: () => ({ exec: async () => [{ id: "s1", created: new Date("2026-10-04T10:00:00Z") }] }),
  });
});

it("401s for non-admins", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
  expect(mockDb.shortScripts.list).not.toHaveBeenCalled();
});

it("returns light rows and the format scenes' state", async () => {
  mockDb.shortScripts.list.mockResolvedValue([
    {
      id: "s1",
      template: "lineup",
      scope: { type: "country", id: "japan" },
      include: { alerts: false, quakes: false, volcanoes: false },
      title: "Japan round-up",
      clips: [clip("a", 20_000), clip("b", 15_000)],
      status: "draft",
      plays: [play, { ...play, sceneId: "shorts-preview" }],
    },
    { id: "s2", template: "lineup", scope: { type: "globe" }, include: {}, title: "World", clips: [], status: "draft" },
  ]);
  mockDb.getScene.mockResolvedValue({ id: "shorts", watchToken: "tok" });
  mockDb.getOrInitDirectorConfig.mockResolvedValue({ mode: "script", script: { scriptId: "s1", fromClip: 0, playNonce: 7, record: false } });

  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  // The default format is listed before it's seeded.
  expect(body.formats).toEqual([
    {
      id: "shorts",
      name: "Round-up",
      preview: { sceneId: "shorts", exists: true, watchToken: "tok", mode: "script", scriptId: "s1", playNonce: 7 },
    },
  ]);
  expect(body.scripts[0]).toEqual({
    id: "s1",
    formatId: "shorts",
    title: "Japan round-up",
    scope: { type: "country", id: "japan" },
    status: "draft",
    clipCount: 2,
    durationMs: 35_000,
    created: "2026-10-04T10:00:00.000Z",
    // Its format scene's play only, and without its per-clip schedule.
    previewPlay: { sceneId: "shorts", playNonce: 7, startedAt: 1000, endedAt: 5000, skipped: play.skipped },
  });
  expect(body.scripts[1]).toEqual({
    id: "s2",
    formatId: "shorts",
    title: "World",
    scope: { type: "globe" },
    status: "draft",
    clipCount: 0,
    durationMs: 0,
  });
});

it("lists every format, the default first, and a script's play on its own format's scene", async () => {
  mockDb.shortFormats.list.mockResolvedValue([
    { id: "short-a", name: "A" },
    { id: "shorts", name: "Mine" },
  ]);
  mockDb.shortScripts.list.mockResolvedValue([
    { id: "s1", formatId: "short-a", scope: { type: "globe" }, title: "T", clips: [], status: "draft", plays: [play, { ...play, sceneId: "short-a", playNonce: 9 }] },
  ]);
  mockDb.getScene.mockResolvedValue(null);
  const body = await (await GET()).json();
  expect(body.formats.map((f: { id: string; name: string }) => [f.id, f.name])).toEqual([
    ["shorts", "Mine"],
    ["short-a", "A"],
  ]);
  expect(body.scripts[0]).toMatchObject({ formatId: "short-a", previewPlay: { sceneId: "short-a", playNonce: 9 } });
});

it("reports a missing format scene without seeding its director config", async () => {
  mockDb.shortScripts.list.mockResolvedValue([]);
  mockDb.getScene.mockResolvedValue(null);
  const body = await (await GET()).json();
  expect(body.formats[0].preview).toEqual({ sceneId: "shorts", exists: false, mode: "off" });
  expect(mockDb.getOrInitDirectorConfig).not.toHaveBeenCalled();
});
