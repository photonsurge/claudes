/** @jest-environment node */

/**
 * Plan §8.3, §8.4 — PATCH /api/crossword/players/:id: admin only, withApiLog,
 * hide and unhide.
 */
jest.mock("../../../../../lib/api-log", () => ({
  withApiLog: (h: (...a: unknown[]) => unknown) => Object.assign((...a: unknown[]) => h(...a), { __logged: true }),
}));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
const mockDb = { crosswordPlayers: { setHidden: jest.fn() } };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { PATCH } from "./route";

const patch = (id: string, body: unknown) =>
  PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
  mockDb.crosswordPlayers.setHidden.mockResolvedValue(true);
});

it("is wrapped in withApiLog", () => {
  expect((PATCH as unknown as { __logged?: boolean }).__logged).toBe(true);
});

it("401s a non-admin and changes nothing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await patch("youtube:A", { hidden: true })).status).toBe(401);
  expect(mockDb.crosswordPlayers.setHidden).not.toHaveBeenCalled();
});

it("hides and unhides, with the id encoded or not", async () => {
  expect((await patch("youtube%3AA", { hidden: true })).status).toBe(200);
  expect(mockDb.crosswordPlayers.setHidden).toHaveBeenLastCalledWith("youtube:A", true);
  expect((await patch("sim:bob", { hidden: false })).status).toBe(200);
  expect(mockDb.crosswordPlayers.setHidden).toHaveBeenLastCalledWith("sim:bob", false);
});

it("refuses a body without a boolean hidden", async () => {
  for (const body of [{}, { hidden: "yes" }, { name: "Evil" }]) {
    const res = await patch("youtube:A", body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  }
  expect(mockDb.crosswordPlayers.setHidden).not.toHaveBeenCalled();
});
