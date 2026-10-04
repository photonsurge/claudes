/** @jest-environment node */

/**
 * GET /api/shorts — the /admin/shorts snapshot: light script rows (created
 * time joined in, preview play without its clip schedule) + the preview scene.
 */
jest.mock("../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = {
  shortScripts: {
    list: jest.fn(),
    model: { find: jest.fn() },
  },
  getScene: jest.fn(),
  getOrInitDirectorConfig: jest.fn(),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../lib/require-admin";
import { GET } from "./route";

const clip = (id: string, durationMs: number) => ({ id, target: `country:${id}`, durationMs, label: { title: id } });
const play = {
  sceneId: "shorts-preview",
  playNonce: 7,
  startedAt: 1000,
  endedAt: 5000,
  clips: [{ id: "a", startMs: 0, durationMs: 20_000 }],
  skipped: [{ id: "b", reason: "alert expired" }],
};

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
  mockDb.shortScripts.model.find.mockReturnValue({
    lean: () => ({ exec: async () => [{ id: "s1", created: new Date("2026-10-04T10:00:00Z") }] }),
  });
});

it("401s for non-admins", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
  expect(mockDb.shortScripts.list).not.toHaveBeenCalled();
});

it("returns light rows and the preview scene's state", async () => {
  mockDb.shortScripts.list.mockResolvedValue([
    {
      id: "s1",
      template: "lineup",
      scope: { type: "country", id: "japan" },
      include: { alerts: false, quakes: false, volcanoes: false },
      title: "Japan round-up",
      clips: [clip("a", 20_000), clip("b", 15_000)],
      status: "draft",
      plays: [play, { ...play, sceneId: "shorts" }],
    },
    { id: "s2", template: "lineup", scope: { type: "globe" }, include: {}, title: "World", clips: [], status: "draft" },
  ]);
  mockDb.getScene.mockResolvedValue({ id: "shorts-preview", watchToken: "tok" });
  mockDb.getOrInitDirectorConfig.mockResolvedValue({ mode: "script", script: { scriptId: "s1", fromClip: 0, playNonce: 7, record: false } });

  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.preview).toEqual({
    sceneId: "shorts-preview",
    exists: true,
    watchToken: "tok",
    mode: "script",
    scriptId: "s1",
    playNonce: 7,
  });
  expect(body.scripts[0]).toEqual({
    id: "s1",
    title: "Japan round-up",
    scope: { type: "country", id: "japan" },
    status: "draft",
    clipCount: 2,
    durationMs: 35_000,
    created: "2026-10-04T10:00:00.000Z",
    // The preview scene's play only, and without its per-clip schedule.
    previewPlay: { sceneId: "shorts-preview", playNonce: 7, startedAt: 1000, endedAt: 5000, skipped: play.skipped },
  });
  expect(body.scripts[1]).toEqual({ id: "s2", title: "World", scope: { type: "globe" }, status: "draft", clipCount: 0, durationMs: 0 });
});

it("reports a missing preview scene without seeding its director config", async () => {
  mockDb.shortScripts.list.mockResolvedValue([]);
  mockDb.getScene.mockResolvedValue(null);
  const body = await (await GET()).json();
  expect(body.preview).toEqual({ sceneId: "shorts-preview", exists: false, mode: "off" });
  expect(mockDb.getOrInitDirectorConfig).not.toHaveBeenCalled();
});
