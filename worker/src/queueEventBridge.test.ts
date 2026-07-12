import { queueEventToPayload } from "./queueEventBridge";

describe("queueEventToPayload", () => {
  it("maps a job-scoped event to its phase + jobId", () => {
    expect(queueEventToPayload("active", { jobId: "42", prev: "waiting" })).toEqual({
      phase: "active",
      jobId: "42",
      extra: { prev: "waiting" },
    });
  });

  it("carries the job name on `added`", () => {
    expect(queueEventToPayload("added", { jobId: "7", name: "do" })).toEqual({
      phase: "added",
      jobId: "7",
      extra: { name: "do" },
    });
  });

  it("truncates a huge failedReason so it never bloats the socket frame", () => {
    const reason = "x".repeat(2000);
    const out = queueEventToPayload("failed", { jobId: "9", failedReason: reason, prev: "active" });
    expect(out?.phase).toBe("failed");
    expect((out?.extra.failedReason as string).length).toBe(500);
    expect(out?.extra.prev).toBe("active");
  });

  it("has no jobId for queue-wide events", () => {
    expect(queueEventToPayload("drained", "event-id-123")).toEqual({ phase: "drained", jobId: null, extra: {} });
    expect(queueEventToPayload("cleaned", { count: "5" })).toEqual({ phase: "cleaned", jobId: null, extra: { count: 5 } });
    expect(queueEventToPayload("paused", {})).toEqual({ phase: "paused", jobId: null, extra: {} });
  });

  it("coerces a missing cleaned count to 0", () => {
    expect(queueEventToPayload("cleaned", {})?.extra.count).toBe(0);
  });

  it("ignores events we don't relay", () => {
    expect(queueEventToPayload("waiting-children", { jobId: "1" })).toBeNull();
    expect(queueEventToPayload("deduplicated", { jobId: "1" })).toBeNull();
  });

  it("tolerates a null jobId on job-scoped events", () => {
    expect(queueEventToPayload("active", {})).toEqual({ phase: "active", jobId: null, extra: { prev: null } });
  });
});
