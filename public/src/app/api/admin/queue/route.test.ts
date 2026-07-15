/** @jest-environment node */

/**
 * The queue admin API's backlog view and cancel-by-kind.
 *
 * Both exist because a real backlog arrives by TYPE — a few schedules re-firing
 * work that went stale hours ago — not as N distinct problems. The job list is
 * newest-first and truncated, so it shows the froth rather than the shape, and
 * cancelling 200 jobs one row at a time isn't a thing an operator will do.
 */
const mockGetJobs = jest.fn();
const mockGetJobCounts = jest.fn();
const mockIsPaused = jest.fn();
const mockGetJobSchedulers = jest.fn();

jest.mock("@photonsurge/shared/bull/bull", () => ({
  getQueue: () => ({
    name: "weather",
    getJobs: (...a: unknown[]) => mockGetJobs(...a),
    getJobCounts: (...a: unknown[]) => mockGetJobCounts(...a),
    isPaused: () => mockIsPaused(),
    getJobSchedulers: (...a: unknown[]) => mockGetJobSchedulers(...a),
    getRepeatableJobs: async () => [],
  }),
  clearQueue: jest.fn(),
}));
jest.mock("@photonsurge/shared/utill/BackLogger", () => ({ PublicBackLogger: jest.fn() }));
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

import { GET, POST } from "./route";

/** A queued job with a remove() we can watch. */
const job = (type: string, event: string, timestamp = 1_000, onRemove?: jest.Mock) => ({
  id: `${type}.${event}.${timestamp}`,
  data: { type, event },
  timestamp,
  remove: onRemove ?? jest.fn().mockResolvedValue(undefined),
});

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/admin/queue", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetJobCounts.mockResolvedValue({ waiting: 3 });
  mockIsPaused.mockResolvedValue(false);
  mockGetJobSchedulers.mockResolvedValue([]);
});

describe("GET backlog", () => {
  it("is not computed unless asked for — the dashboard polls", async () => {
    mockGetJobs.mockResolvedValue([]);

    const res = await GET(new Request("http://localhost/api/admin/queue?state=active") as never);

    expect((await res.json()).backlog).toEqual([]);
    // Only the state read, no full backlog scan.
    expect(mockGetJobs).toHaveBeenCalledTimes(1);
  });

  it("groups queued work by kind, biggest first", async () => {
    mockGetJobs.mockImplementation(async (states: string[]) =>
      states.includes("active")
        ? []
        : [job("weather", "refreshMrms"), job("events", "acquire"), job("weather", "refreshMrms"), job("weather", "refreshMrms")],
    );

    const res = await GET(new Request("http://localhost/api/admin/queue?state=active&backlog=1") as never);

    expect((await res.json()).backlog).toEqual([
      { type: "weather", event: "refreshMrms", count: 3, oldest: 1000 },
      { type: "events", event: "acquire", count: 1, oldest: 1000 },
    ]);
  });

  it("counts prioritized jobs, which sit outside `waiting`", async () => {
    // sendToQueue sets a priority, so BullMQ files those separately — a backlog
    // can hide there entirely (69 of them, last time this was measured).
    let asked: string[] = [];
    mockGetJobs.mockImplementation(async (states: string[]) => {
      if (states.includes("active")) return [];
      asked = states;
      return [];
    });

    await GET(new Request("http://localhost/api/admin/queue?state=active&backlog=1") as never);

    expect(asked).toEqual(expect.arrayContaining(["waiting", "delayed", "prioritized", "paused"]));
  });

  it("reports the oldest of each kind, not the newest", async () => {
    mockGetJobs.mockImplementation(async (states: string[]) =>
      states.includes("active") ? [] : [job("weather", "refreshMrms", 9_000), job("weather", "refreshMrms", 2_000)],
    );

    const res = await GET(new Request("http://localhost/api/admin/queue?state=active&backlog=1") as never);

    expect((await res.json()).backlog[0].oldest).toBe(2_000);
  });

  it("ignores a job with no type rather than inventing a kind", async () => {
    mockGetJobs.mockImplementation(async (states: string[]) =>
      states.includes("active") ? [] : [{ id: "x", data: {}, timestamp: 1 }, job("alerts", "ingest")],
    );

    const res = await GET(new Request("http://localhost/api/admin/queue?state=active&backlog=1") as never);

    expect((await res.json()).backlog).toHaveLength(1);
  });
});

describe("POST cancelType", () => {
  it("removes every not-yet-started job of one kind", async () => {
    const doomed = [jest.fn().mockResolvedValue(undefined), jest.fn().mockResolvedValue(undefined)];
    mockGetJobs.mockResolvedValue([
      job("weather", "refreshMrms", 1, doomed[0]),
      job("weather", "refreshMrms", 2, doomed[1]),
      job("alerts", "ingest"),
    ]);

    const res = await post({ action: "cancelType", type: "weather", event: "refreshMrms" });

    expect((await res.json()).detail).toEqual({ removed: 2, matched: 2 });
    for (const d of doomed) expect(d).toHaveBeenCalled();
  });

  it("leaves other kinds alone", async () => {
    const spared = jest.fn();
    mockGetJobs.mockResolvedValue([job("weather", "refreshMrms"), job("alerts", "ingest", 1, spared)]);

    await post({ action: "cancelType", type: "weather", event: "refreshMrms" });

    expect(spared).not.toHaveBeenCalled();
  });

  it("clears a whole domain when no event is given", async () => {
    mockGetJobs.mockResolvedValue([
      job("weather", "refreshMrms"),
      job("weather", "refreshRtofs"),
      job("alerts", "ingest"),
    ]);

    const res = await post({ action: "cancelType", type: "weather" });

    expect((await res.json()).detail).toEqual({ removed: 2, matched: 2 });
  });

  it("sweeps prioritized too", async () => {
    mockGetJobs.mockResolvedValue([]);

    await post({ action: "cancelType", type: "weather" });

    expect(mockGetJobs).toHaveBeenCalledWith(
      expect.arrayContaining(["waiting", "delayed", "prioritized", "paused"]),
      0,
      -1,
      false,
    );
  });

  it("never touches an active job — BullMQ can't preempt one", async () => {
    let asked: string[] = [];
    mockGetJobs.mockImplementation(async (states: string[]) => {
      asked = states;
      return [];
    });

    await post({ action: "cancelType", type: "weather" });

    expect(asked).not.toContain("active");
  });

  it("counts a job that vanishes mid-sweep as done, not as a failure", async () => {
    // Picked up by the worker, or binned by another operator — either way the
    // outcome is what we wanted; it must not fail the whole call.
    mockGetJobs.mockResolvedValue([
      job("weather", "refreshMrms", 1, jest.fn().mockRejectedValue(new Error("missing key"))),
      job("weather", "refreshMrms", 2),
    ]);

    const res = await post({ action: "cancelType", type: "weather" });

    expect(res.status).toBe(200);
    expect((await res.json()).detail).toEqual({ removed: 1, matched: 2 });
  });

  it("refuses without a type rather than binning the queue", async () => {
    const res = await post({ action: "cancelType" });

    expect(res.status).toBe(400);
    expect(mockGetJobs).not.toHaveBeenCalled();
  });
});
