/** @jest-environment node */

/** GET /api/crossword/puzzles — admin only; light rows (no answers), filtered by status, source and title. */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
const mockDb = { crosswordPuzzles: { list: jest.fn() } };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../lib/require-admin";
import { GET } from "./route";

const entry = { id: "1A", num: 1, dir: "across", row: 0, col: 0, answer: "CRATER", clue: "Volcano's mouth" };
const p = (id: string, extra: object = {}) => ({
  id,
  title: `T ${id}`,
  width: 9,
  height: 7,
  entries: [entry, { ...entry, id: "2A" }],
  status: "ready",
  familyFriendly: false,
  source: "bank",
  createdAt: 100,
  plays: [],
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
  mockDb.crosswordPuzzles.list.mockResolvedValue([
    p("a", { familyFriendly: true, source: "themed", plays: [{ sceneId: "xw", startedAt: 5 }, { sceneId: "xw", startedAt: 9, endedAt: 10 }] }),
    p("b"),
  ]);
});

const get = (qs = "") => GET(new Request(`http://x/api/crossword/puzzles${qs}`));

it("is admin only", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await get()).status).toBe(401);
  expect(mockDb.crosswordPuzzles.list).not.toHaveBeenCalled();
});

it("lists rows with counts and no answers", async () => {
  const body = await (await get()).json();
  expect(JSON.stringify(body)).not.toContain("CRATER");
  expect(body.puzzles[0]).toEqual({
    id: "a",
    title: "T a",
    status: "ready",
    familyFriendly: true,
    source: "themed",
    createdAt: 100,
    width: 9,
    height: 7,
    words: 2,
    plays: 2,
    lastPlayedAt: 9,
    scenes: ["xw"],
    playLog: [
      { sceneId: "xw", startedAt: 5 },
      { sceneId: "xw", startedAt: 9 },
    ],
  });
  expect(mockDb.crosswordPuzzles.list).toHaveBeenCalledWith({ limit: 500 });
});

it("filters status in Mongo, source and title here; ignores junk", async () => {
  await get("?status=ready");
  expect(mockDb.crosswordPuzzles.list).toHaveBeenLastCalledWith({ status: "ready", limit: 500 });
  await get("?status=nope");
  expect(mockDb.crosswordPuzzles.list).toHaveBeenLastCalledWith({ limit: 500 });
  expect((await (await get("?source=themed")).json()).puzzles.map((r: { id: string }) => r.id)).toEqual(["a"]);
  expect((await (await get("?q=volc")).json()).puzzles.map((r: { id: string }) => r.id)).toEqual([]);
  expect((await (await get("?q=t%20b")).json()).puzzles.map((r: { id: string }) => r.id)).toEqual(["b"]);
});
