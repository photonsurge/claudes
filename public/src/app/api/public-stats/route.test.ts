/** @jest-environment node */

/**
 * GET /api/public-stats — the public app's own memory readout. Pins the guard
 * (admin session OR QUEUE_LOG_KEY, never anonymous) and the payload shape the
 * /admin/queue card + curl tooling rely on.
 */
jest.mock("../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

const mockCookieGet = jest.fn();
const mockHeaderGet = jest.fn();
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: mockCookieGet }),
  headers: async () => ({ get: mockHeaderGet }),
}));

const mockIsAdmin = jest.fn();
jest.mock("@photonsurge/shared/utill/session", () => ({
  SESSION_COOKIE: "session",
  readSession: (t: string) => ({ token: t }),
  isAdmin: (...args: unknown[]) => mockIsAdmin(...args),
}));

import { GET } from "./route";

const req = (url = "http://x/api/public-stats") => new Request(url);

beforeEach(() => {
  mockCookieGet.mockReturnValue(undefined);
  mockHeaderGet.mockReturnValue(null);
  mockIsAdmin.mockReturnValue(false);
  delete process.env.QUEUE_LOG_KEY;
});

describe("GET /api/public-stats", () => {
  it("rejects anonymous requests (no session, no key configured)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("rejects a wrong key and never allows key auth when QUEUE_LOG_KEY is unset", async () => {
    expect((await GET(req("http://x/api/public-stats?key=nope"))).status).toBe(401);
    process.env.QUEUE_LOG_KEY = "s3cret";
    expect((await GET(req("http://x/api/public-stats?key=wrong"))).status).toBe(401);
  });

  it("serves the memory split to a valid key", async () => {
    process.env.QUEUE_LOG_KEY = "s3cret";
    const res = await GET(req("http://x/api/public-stats?key=s3cret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    // Real numbers from this test process — sanity, not exact values.
    expect(body.rssMB).toBeGreaterThan(0);
    expect(body.heapUsedMB).toBeGreaterThan(0);
    expect(body.heapLimitMB).toBeGreaterThan(body.heapUsedMB);
    expect(typeof body.nativeGapMB).toBe("number");
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it("serves an admin session without any key", async () => {
    mockCookieGet.mockReturnValue({ value: "tok" });
    mockIsAdmin.mockReturnValue(true);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });
});
