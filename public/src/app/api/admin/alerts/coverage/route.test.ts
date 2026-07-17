/** @jest-environment node */

/**
 * GET /api/admin/alerts/coverage — derives the drawable/no-shape/partial split +
 * pcts from the alerts repo's raw geometryCoverage() counts.
 */
const mockCoverage = jest.fn();

jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({ alerts: { geometryCoverage: () => mockCoverage() } }),
}));
jest.mock("../../../../../lib/focus/focus-cache", () => ({
  withCache: async (_k: string, _t: number, fn: () => Promise<unknown>) => ({ value: await fn(), hit: false }),
}));
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

import { GET } from "./route";

describe("GET /api/admin/alerts/coverage", () => {
  it("derives drawable counts + pcts from the raw coverage", async () => {
    mockCoverage.mockResolvedValue({ alerts: 5445, alertsNoShape: 1074, alertsPartial: 3, areas: 8246, areasNoGeom: 2317 });

    const res = await GET(new Request("http://x/api/admin/alerts/coverage"));
    const body = await res.json();

    expect(body.drawableAlerts).toBe(5445 - 1074); // 4371
    expect(body.areasDrawn).toBe(8246 - 2317); // 5929
    expect(body.areasDrawnPct).toBe(71.9);
    expect(body.alertsDrawnPct).toBe(80.3);
  });

  it("is divide-by-zero safe on an empty feed", async () => {
    mockCoverage.mockResolvedValue({ alerts: 0, alertsNoShape: 0, alertsPartial: 0, areas: 0, areasNoGeom: 0 });

    const res = await GET(new Request("http://x/api/admin/alerts/coverage"));
    const body = await res.json();

    expect(body.areasDrawnPct).toBe(0);
    expect(body.alertsDrawnPct).toBe(0);
  });
});
