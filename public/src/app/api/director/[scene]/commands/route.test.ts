/** @jest-environment node */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
const mockDb = {
  getOrInitDirectorConfig: jest.fn(),
  directorCommands: { enqueue: jest.fn(), recent: jest.fn() },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { GET, POST } from "./route";

const params = { params: Promise.resolve({ scene: "wind" }) };
const post = (body: unknown) =>
  POST(new Request("http://x/api/director/wind/commands", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), params);

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ sub: "u1", email: "op@x", role: "admin" });
  mockDb.getOrInitDirectorConfig.mockResolvedValue({ mode: "auto" });
  mockDb.directorCommands.enqueue.mockImplementation(async (input: any) => ({ id: "c1", ...input }));
});

describe("POST /api/director/:scene/commands", () => {
  it("rejects anonymous requests", async () => {
    (requireAdmin as jest.Mock).mockResolvedValue(null);
    expect((await post({ op: "skip" })).status).toBe(401);
    expect(mockDb.directorCommands.enqueue).not.toHaveBeenCalled();
  });

  it("rejects an invalid op", async () => {
    expect((await post({ op: "explode" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(mockDb.directorCommands.enqueue).not.toHaveBeenCalled();
  });

  it("queues a valid op as the signed-in operator with a 10 minute expiry", async () => {
    const res = await post({ op: "cut", target: { type: "segment", id: "quake:us1" } });
    expect(res.status).toBe(202);
    const input = mockDb.directorCommands.enqueue.mock.calls[0][0];
    expect(input).toMatchObject({
      sceneId: "wind",
      source: { kind: "operator", user: "op@x" },
      cmd: { op: "cut", target: { type: "segment", id: "quake:us1" } },
      ttlMs: 600_000,
    });
    expect(input.status).toBeUndefined();
  });

  it("logs and refuses a command when the director is off", async () => {
    mockDb.getOrInitDirectorConfig.mockResolvedValue({ mode: "off" });
    const res = await post({ op: "skip" });
    expect(res.status).toBe(409);
    expect(mockDb.directorCommands.enqueue.mock.calls[0][0]).toMatchObject({ status: "refused", note: "director is off" });
    expect((await res.json()).command.note).toBe("director is off");
  });
});

describe("GET /api/director/:scene/commands", () => {
  it("is admin-only even though director GETs are public", async () => {
    (requireAdmin as jest.Mock).mockResolvedValue(null);
    expect((await GET(new Request("http://x/api/director/wind/commands"), params)).status).toBe(401);
  });

  it("returns the scene's log with the since/limit it was asked for", async () => {
    mockDb.directorCommands.recent.mockResolvedValue([{ id: "c1" }]);
    const res = await GET(new Request("http://x/api/director/wind/commands?since=5&limit=7"), params);
    expect(await res.json()).toEqual({ commands: [{ id: "c1" }] });
    expect(mockDb.directorCommands.recent).toHaveBeenCalledWith("wind", { since: 5, limit: 7 });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
