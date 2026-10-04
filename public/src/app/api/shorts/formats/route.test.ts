/** @jest-environment node */

/**
 * GET/POST /api/shorts/formats — the format list (default first, with script
 * counts) and create-by-duplicate, with each refusal mapped to its status.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/db/short-format-copy", () => ({ duplicateFormat: jest.fn() }));

const mockDb = {
  shortFormats: { list: jest.fn() },
  shortScripts: { countByFormat: jest.fn() },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../lib/require-admin";
import { duplicateFormat } from "@photonsurge/shared/db/short-format-copy";
import { defaultShortFormat } from "@photonsurge/shared/short-format";
import { GET, POST } from "./route";

const post = (body: unknown) => POST(new Request("http://x/api/shorts/formats", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("401s for non-admins", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
  expect((await post({ name: "A", from: "default" })).status).toBe(401);
  expect(duplicateFormat).not.toHaveBeenCalled();
});

it("lists formats, the default first, each with its script count", async () => {
  mockDb.shortFormats.list.mockResolvedValue([defaultShortFormat("short-a", "A"), defaultShortFormat()]);
  mockDb.shortScripts.countByFormat.mockImplementation(async (id: string) => (id === "shorts" ? 4 : 0));
  const body = await (await GET()).json();
  expect(body.defaultId).toBe("shorts");
  expect(body.formats.map((f: { id: string; scriptCount: number }) => [f.id, f.scriptCount])).toEqual([
    ["shorts", 4],
    ["short-a", 0],
  ]);
  expect(body.formats[1]).toMatchObject(defaultShortFormat("short-a", "A"));
});

it("creates a format by duplicating, 201 with the new format", async () => {
  const format = defaultShortFormat("short-uk", "UK");
  (duplicateFormat as jest.Mock).mockResolvedValue({ ok: true, format });
  const res = await post({ name: "UK", from: " wind " });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ format });
  expect((duplicateFormat as jest.Mock).mock.calls[0][1]).toEqual({ name: "UK", from: "wind" });
});

it("400s without a source; maps each refusal to its status", async () => {
  expect((await post({ name: "UK" })).status).toBe(400);
  expect(duplicateFormat).not.toHaveBeenCalled();
  for (const [code, status] of [["bad-name", 400], ["no-source", 404], ["exists", 409]] as const) {
    (duplicateFormat as jest.Mock).mockResolvedValueOnce({ ok: false, code, error: `nope: ${code}` });
    const res = await post({ name: "UK", from: "wind" });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: `nope: ${code}` });
  }
});
