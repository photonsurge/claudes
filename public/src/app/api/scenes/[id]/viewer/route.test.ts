/** @jest-environment node */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
let mockCookie: string | undefined;
jest.mock("next/headers", () => ({ cookies: async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) }) }));
jest.mock("@photonsurge/shared/utill/session", () => ({
  SESSION_COOKIE: "s",
  readSession: (t: string) => (t === "admin" ? { role: "admin" } : null),
  isAdmin: (s: { role?: string } | null) => s?.role === "admin",
}));
const mockDb = { getScene: jest.fn(), getOrInitBroadcastState: jest.fn(), viewerState: { get: jest.fn() } };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { GET } from "./route";

const get = (id: string, q = "") => GET(new Request(`http://x/api/scenes/${id}/viewer${q}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockCookie = undefined;
  mockDb.viewerState.get.mockResolvedValue({ sceneId: "wind" });
});

it("404s for an unknown scene", async () => {
  mockDb.getScene.mockResolvedValue(null);
  expect((await get("nope")).status).toBe(404);
});

it("needs the watch token or an admin session for a scene", async () => {
  mockDb.getScene.mockResolvedValue({ watchToken: "tok" });
  expect((await get("wind")).status).toBe(401);
  expect((await get("wind", "?token=bad")).status).toBe(401);
  expect((await get("wind", "?token=tok")).status).toBe(200);
  mockCookie = "admin";
  expect((await get("wind")).status).toBe(200);
});

it("serves the main scene's picks to its public output", async () => {
  mockDb.getOrInitBroadcastState.mockResolvedValue({ watchToken: "tok" });
  const res = await get("default");
  expect(res.status).toBe(200);
  expect(mockDb.viewerState.get).toHaveBeenCalledWith("default");
});
