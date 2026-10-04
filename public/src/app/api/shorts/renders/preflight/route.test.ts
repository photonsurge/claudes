/** @jest-environment node */

/** POST /api/shorts/renders/preflight — the offline test's preflight report, built by the worker. */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToQueueAndWait: jest.fn() }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/shorts/renders/preflight", { method: "POST", body: JSON.stringify(body) }) as never);

const REQ = { encoderId: "v1", what: { type: "script", scriptId: "s1" }, publishAs: "private", offline: true };

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("401s for non-admins", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await post(REQ)).status).toBe(401);
  expect(sendToQueueAndWait).not.toHaveBeenCalled();
});

it("400s a body that isn't a render request", async () => {
  expect((await post({ encoderId: "v1" })).status).toBe(400);
  expect(sendToQueueAndWait).not.toHaveBeenCalled();
});

it("hands the sanitised request to the worker and returns its report", async () => {
  const report = { ok: true, at: 1, script: { level: "ok", clips: [], skipped: [] } };
  (sendToQueueAndWait as jest.Mock).mockResolvedValue({ ok: true, report });
  const res = await post(REQ);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, report });
  expect(sendToQueueAndWait).toHaveBeenCalledWith(
    "stream",
    "run-lifecycle",
    "renderPreflight",
    { request: { encoderId: "v1", what: { type: "script", scriptId: "s1" }, publishAs: "private", offline: true } },
    expect.any(Number),
    undefined,
    { dedupe: false },
  );
});

it("422s a worker refusal and 504s no answer", async () => {
  (sendToQueueAndWait as jest.Mock).mockResolvedValue({ ok: false, error: "not a render request" });
  expect((await post(REQ)).status).toBe(422);
  (sendToQueueAndWait as jest.Mock).mockRejectedValue(new Error("timed out before finishing"));
  expect((await post(REQ)).status).toBe(504);
});
