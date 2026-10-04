/** @jest-environment node */

/** GET /api/crossword/words/:id — admin-only; one bank word or 404. */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = { crosswordBank: { getWordById: jest.fn() } };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op@example.com" });
});

it("401s for non-admins without touching the bank", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET(new Request("http://x"), ctx("a1"))).status).toBe(401);
  expect(mockDb.crosswordBank.getWordById).not.toHaveBeenCalled();
});

it("returns the word", async () => {
  mockDb.crosswordBank.getWordById.mockResolvedValue({ id: "a1", word: "wreck", clues: [], senses: [] });
  const res = await GET(new Request("http://x"), ctx("a1"));
  expect(res.status).toBe(200);
  expect(mockDb.crosswordBank.getWordById).toHaveBeenCalledWith("a1");
  expect((await res.json()).word).toBe("wreck");
});

it("404s an unknown word", async () => {
  mockDb.crosswordBank.getWordById.mockResolvedValue(null);
  expect((await GET(new Request("http://x"), ctx("nope"))).status).toBe(404);
});
