/** @jest-environment node */

/**
 * POST /api/scenes/:id/rotate-token — issues a new watch token, invalidating
 * any previously-copied /watch URL. Admin-only via proxy.ts's matcher (POST
 * isn't GET-like), not re-checked here — untested until now.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

const mockRotate = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({ rotateSceneToken: (...a: unknown[]) => mockRotate(...a) }),
}));

import { POST } from "./route";

const post = (id: string) =>
  POST(new Request(`http://x/api/scenes/${id}/rotate-token`, { method: "POST" }) as never, {
    params: Promise.resolve({ id }),
  });

beforeEach(() => mockRotate.mockReset());

describe("POST /api/scenes/:id/rotate-token", () => {
  it("404s a scene that doesn't exist", async () => {
    mockRotate.mockResolvedValue(null);
    const res = await post("nope");
    expect(res.status).toBe(404);
  });

  it("200s with the freshly minted token", async () => {
    mockRotate.mockResolvedValue("new-token-xyz");
    const res = await post("atlantic-wind");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ watchToken: "new-token-xyz" });
    expect(mockRotate).toHaveBeenCalledWith("atlantic-wind");
  });
});
