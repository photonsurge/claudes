/** @jest-environment node */

/** POST /api/shorts/formats/:id/copy-look — re-copy a source's look onto a format. */
jest.mock("../../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/db/short-format-copy", () => ({ copyLookFrom: jest.fn() }));
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => ({}) }));

import { requireAdmin } from "../../../../../../lib/require-admin";
import { copyLookFrom } from "@photonsurge/shared/db/short-format-copy";
import { POST } from "./route";

const post = (id: string, body: unknown) =>
  POST(new Request(`http://x/api/shorts/formats/${id}/copy-look`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("401s for non-admins and 400s without a source", async () => {
  (requireAdmin as jest.Mock).mockResolvedValueOnce(null);
  expect((await post("short-uk", { from: "wind" })).status).toBe(401);
  expect((await post("short-uk", {})).status).toBe(400);
  expect(copyLookFrom).not.toHaveBeenCalled();
});

it("copies and returns the format; maps a refusal to its status", async () => {
  (copyLookFrom as jest.Mock).mockResolvedValueOnce({ ok: true, format: { id: "short-uk" } });
  const res = await post("short-uk", { from: " wind " });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ format: { id: "short-uk" } });
  expect((copyLookFrom as jest.Mock).mock.calls[0].slice(1)).toEqual(["short-uk", "wind"]);

  (copyLookFrom as jest.Mock).mockResolvedValueOnce({ ok: false, code: "no-source", error: "no channel" });
  expect((await post("short-uk", { from: "ghost" })).status).toBe(404);
});
