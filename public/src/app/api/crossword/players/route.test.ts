/** @jest-environment node */

/**
 * GET /api/crossword/players and PATCH /api/crossword/players/:id — admin
 * only; the list joins all-time totals onto every player; hide and unhide.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
const mockDb = {
  crosswordPlayers: { list: jest.fn(), setHidden: jest.fn() },
  crosswordSolves: { board: jest.fn() },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../lib/require-admin";
import { GET } from "./route";
import { PATCH } from "./[id]/route";

const player = (id: string, hidden = false) => ({ id, name: id.split(":")[1], hidden, firstSeen: 1, lastSeen: 2 });
const patch = (id: string, body: unknown) =>
  PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
  mockDb.crosswordPlayers.list.mockResolvedValue([player("youtube:abc"), player("sim:rich", true)]);
  mockDb.crosswordSolves.board.mockResolvedValue([{ playerId: "sim:rich", name: "rich", points: 12, words: 3 }]);
  mockDb.crosswordPlayers.setHidden.mockResolvedValue(true);
});

it("is admin only", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET(new Request("http://x/api/crossword/players"))).status).toBe(401);
  expect((await patch("sim:rich", { hidden: true })).status).toBe(401);
  expect(mockDb.crosswordPlayers.setHidden).not.toHaveBeenCalled();
});

it("lists players with all-time totals, hidden ones included", async () => {
  const body = await (await GET(new Request("http://x/api/crossword/players?search=ri"))).json();
  expect(body.players).toEqual([
    { ...player("youtube:abc"), points: 0, words: 0 },
    { ...player("sim:rich", true), points: 12, words: 3 },
  ]);
  expect(mockDb.crosswordPlayers.list).toHaveBeenCalledWith({ limit: 1000, search: "ri" });
  expect(mockDb.crosswordSolves.board).toHaveBeenCalledWith({});
});

it("hides and unhides, decoding the id", async () => {
  expect((await patch("youtube%3Aabc", { hidden: true })).status).toBe(200);
  expect(mockDb.crosswordPlayers.setHidden).toHaveBeenLastCalledWith("youtube:abc", true);
  const res = await patch("sim:rich", { hidden: false });
  expect(await res.json()).toEqual({ ok: true, hidden: false });
});

it("400s a non-boolean and 404s an unknown player", async () => {
  expect((await patch("sim:rich", { hidden: "yes" })).status).toBe(400);
  mockDb.crosswordPlayers.setHidden.mockResolvedValue(false);
  expect((await patch("sim:nobody", { hidden: true })).status).toBe(404);
});
