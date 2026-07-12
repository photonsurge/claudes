import { recentPendingRun, INGEST_STALE_MS } from "./inflight";

const RUN = new Date("2026-07-12T18:00:00.000Z");
const NOW = new Date("2026-07-12T22:00:00.000Z").getTime();

function db(rows: Array<{ id: string; created?: Date | string }>) {
  return {
    weatherRuns: {
      getAll: jest.fn().mockResolvedValue({ success: true, data: rows }),
    },
  };
}

describe("recentPendingRun", () => {
  it("queries the pending run for exactly this model+cycle, newest first", async () => {
    const d = db([]);
    await recentPendingRun(d, "gfs", RUN, INGEST_STALE_MS, NOW);
    expect(d.weatherRuns.getAll).toHaveBeenCalledWith(
      { model: "gfs", run: RUN, status: "pending" },
      { sort: { created: -1 }, limit: 1 },
    );
  });

  it("returns the doc when a pending bake was created within the staleness window", async () => {
    const created = new Date(NOW - 5 * 60 * 1000); // 5 min ago — a live bake
    const found = await recentPendingRun(db([{ id: "live", created }]), "gfs", RUN, INGEST_STALE_MS, NOW);
    expect(found).toEqual({ id: "live", created });
  });

  it("returns null for a STALE pending doc (crashed bake must not wedge the pipeline)", async () => {
    const created = new Date(NOW - 30 * 60 * 1000); // 30 min ago — older than the 20-min cutoff
    const found = await recentPendingRun(db([{ id: "crashed", created }]), "gfs", RUN, INGEST_STALE_MS, NOW);
    expect(found).toBeNull();
  });

  it("returns null when no pending run exists", async () => {
    expect(await recentPendingRun(db([]), "gfs", RUN, INGEST_STALE_MS, NOW)).toBeNull();
  });

  it("returns null when the pending doc has no creation time (can't prove it is live)", async () => {
    expect(await recentPendingRun(db([{ id: "x" }]), "gfs", RUN, INGEST_STALE_MS, NOW)).toBeNull();
  });
});
