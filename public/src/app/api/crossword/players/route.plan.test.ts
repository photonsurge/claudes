/** @jest-environment node */

/**
 * Plan §8.3, §8.4 — GET /api/crossword/players: admin only, withApiLog,
 * totals per player.
 */
jest.mock("../../../../lib/api-log", () => ({
  withApiLog: (h: (...a: unknown[]) => unknown) => Object.assign((...a: unknown[]) => h(...a), { __logged: true }),
}));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
const mockDb = { crosswordPlayers: { list: jest.fn() }, crosswordSolves: { board: jest.fn() } };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../lib/require-admin";
import { GET } from "./route";

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
  mockDb.crosswordPlayers.list.mockResolvedValue([
    { id: "youtube:A", name: "Ann", hidden: false, firstSeen: 1, lastSeen: 5 },
    { id: "sim:bob", name: "Bob", hidden: true, firstSeen: 2, lastSeen: 4 },
    { id: "youtube:C", name: "Cy", hidden: false, firstSeen: 3, lastSeen: 3 },
  ]);
  mockDb.crosswordSolves.board.mockResolvedValue([
    { playerId: "youtube:A", name: "Ann", points: 30, words: 4 },
    { playerId: "sim:bob", name: "Bob", points: 9, words: 2 },
  ]);
});

it("is wrapped in withApiLog", () => {
  expect((GET as unknown as { __logged?: boolean }).__logged).toBe(true);
});

it("401s a non-admin and reads nothing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET(new Request("http://x/api/crossword/players"))).status).toBe(401);
  expect(mockDb.crosswordPlayers.list).not.toHaveBeenCalled();
});

it("lists each player with their totals and hidden flag", async () => {
  const res = await GET(new Request("http://x/api/crossword/players"));
  expect(res.status).toBe(200);
  const rows = (await res.json()).players as { id: string; points: number; words: number; hidden: boolean }[];
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  expect(by["youtube:A"]).toMatchObject({ points: 30, words: 4, hidden: false });
  expect(by["sim:bob"]).toMatchObject({ points: 9, words: 2, hidden: true });
  expect(by["youtube:C"]).toMatchObject({ points: 0, words: 0 });
});
