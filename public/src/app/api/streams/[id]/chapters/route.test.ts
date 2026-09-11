/** @jest-environment node */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToQueueAndWait: jest.fn() }));
import { requireAdmin } from "../../../../../lib/require-admin";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { POST } from "./route";

const post = (id: string) => POST(new Request(`http://x/api/streams/${id}/chapters`, { method: "POST" }) as never, { params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("401s for non-admins without enqueueing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(false);
  expect((await post("r1")).status).toBe(401);
  expect(sendToQueueAndWait).not.toHaveBeenCalled();
});

it("awaits the worker's forced publish and returns its result", async () => {
  (sendToQueueAndWait as jest.Mock).mockResolvedValue({ ok: true, count: 12, changed: true });
  const res = await post("r1");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, count: 12, changed: true });
  expect(sendToQueueAndWait).toHaveBeenCalledWith("stream", "run-lifecycle", "chapters", { runId: "r1", force: true }, 30_000);
});

it("reports a queue timeout as a failed publish, not a 500", async () => {
  (sendToQueueAndWait as jest.Mock).mockRejectedValue(new Error("timed out"));
  const res = await post("r1");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: false, error: "timed out" });
});
