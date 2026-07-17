/** @jest-environment node */

/**
 * GET /api/admin/worker-stats — the server-side proxy to the worker's internal
 * /status. Two things worth pinning: it passes a healthy payload straight
 * through, and it fails SOFT (200 + `status:"down"`) when the worker is
 * unreachable, so /admin/health renders an offline state instead of a 500.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

import { GET } from "./route";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe("GET /api/admin/worker-stats", () => {
  it("passes a healthy worker /status payload through", async () => {
    const payload = {
      status: "ok",
      rssMB: 1800,
      rssPeakMB: 2100,
      heapUsedMB: 900,
      heapLimitMB: 4096,
      byTier: [{ tier: "background", name: "worker-app-bg", concurrency: 4, counts: { active: 2 } }],
      events: [{ label: "weather.refresh", runs: 3, errors: 0, peakHeapDeltaMB: 120, peakRssMB: 2000 }],
    };
    global.fetch = jest.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;

    const res = await GET(new Request("http://x/api/admin/worker-stats"));
    const body = await res.json();

    expect(body.status).toBe("ok");
    expect(body.byTier[0].concurrency).toBe(4);
    expect(body.events[0].peakHeapDeltaMB).toBe(120);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("fails soft (200 + down) when the worker is unreachable", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const res = await GET(new Request("http://x/api/admin/worker-stats"));
    const body = await res.json();

    expect(res.status).toBe(200); // page renders an offline state, not a crash
    expect(body.status).toBe("down");
    expect(body.error).toMatch(/ECONNREFUSED/);
  });

  it("reports down when the worker answers non-2xx", async () => {
    global.fetch = jest.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;

    const res = await GET(new Request("http://x/api/admin/worker-stats"));
    const body = await res.json();

    expect(body.status).toBe("down");
    expect(body.error).toMatch(/503/);
  });
});
