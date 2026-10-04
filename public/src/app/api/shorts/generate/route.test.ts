/** @jest-environment node */

/**
 * POST /api/shorts/generate — sanitises the body, runs the worker's
 * short-video.generate job and waits; the job's own error reaches the operator.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToQueueAndWait: jest.fn() }));
import { requireAdmin } from "../../../../lib/require-admin";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/shorts/generate", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("401s for non-admins without enqueueing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await post({ scope: { type: "globe" } })).status).toBe(401);
  expect(sendToQueueAndWait).not.toHaveBeenCalled();
});

it("400s a body without a valid scope", async () => {
  const res = await post({ scope: { type: "country" } });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/scope/);
  expect(sendToQueueAndWait).not.toHaveBeenCalled();
});

it("sends the sanitised request to the worker and returns its result", async () => {
  const result = { id: "s1", title: "Japan round-up", clips: 2, durationMs: 62_000 };
  (sendToQueueAndWait as jest.Mock).mockResolvedValue(result);
  const res = await post({
    scope: { type: "country", id: " japan ", extra: 1 },
    include: { alerts: "yes", quakes: true },
    budgetMs: 60_000,
    title: "  My title ",
    sceneId: "main",
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(result);
  expect(sendToQueueAndWait).toHaveBeenCalledWith(
    "shorts",
    "short-video",
    "generate",
    {
      scope: { type: "country", id: "japan" },
      include: { alerts: false, quakes: true, volcanoes: false },
      budgetMs: 60_000,
      title: "My title",
    },
    90_000,
  );
});

it("drops a non-positive budget and a blank title", async () => {
  (sendToQueueAndWait as jest.Mock).mockResolvedValue({});
  await post({ scope: { type: "globe" }, budgetMs: -5, title: "  " });
  expect((sendToQueueAndWait as jest.Mock).mock.calls[0][3]).toEqual({
    scope: { type: "globe" },
    include: { alerts: false, quakes: false, volcanoes: false },
  });
});

it("passes the worker's failure message through verbatim", async () => {
  const msg = "No usable round-up for Japan — switch its round-ups on at /admin/place-roundups";
  (sendToQueueAndWait as jest.Mock).mockRejectedValue(new Error(msg));
  const res = await post({ scope: { type: "country", id: "japan" } });
  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({ error: msg });
});

it("reports a wait timeout as 504 with what happens next", async () => {
  (sendToQueueAndWait as jest.Mock).mockRejectedValue(
    new Error("Job wait do timed out before finishing, no finish notification arrived after 90000ms (id=12)"),
  );
  const res = await post({ scope: { type: "globe" } });
  expect(res.status).toBe(504);
  expect((await res.json()).error).toMatch(/No answer from the worker after 90s/);
});
