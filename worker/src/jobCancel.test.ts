jest.mock("./socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn() }));
jest.mock("@photonsurge/shared/utill/bull-utils", () => ({ QUEUE_NAME: "worker-app" }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

import { beginJob, endJob, jobAbortSignal, cancelJob, cancelChannel } from "./jobCancel";
import { emitWorkerEvent } from "./socket";

describe("jobCancel", () => {
  beforeEach(() => jest.clearAllMocks());

  it("exposes an abort signal for a registered job and aborts + discards on cancel", () => {
    const job = { id: "5", data: { type: "weather", event: "check" }, discard: jest.fn() };
    const signal = beginJob("5", job);
    expect(signal.aborted).toBe(false);
    expect(jobAbortSignal(job)).toBe(signal);

    expect(cancelJob("5")).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(job.discard).toHaveBeenCalledTimes(1);
    // Surfaces a notice line to the live console.
    expect(emitWorkerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "queue:log", jobId: "5", data: expect.objectContaining({ label: "weather.check" }) }),
    );
  });

  it("returns false when cancelling an unknown / already-finished job", () => {
    expect(cancelJob("nope")).toBe(false);
    expect(emitWorkerEvent).not.toHaveBeenCalled();
  });

  it("stops exposing the signal after endJob", () => {
    const job = { id: "7", data: {}, discard: jest.fn() };
    beginJob("7", job);
    endJob("7");
    expect(jobAbortSignal(job)).toBeUndefined();
    expect(cancelJob("7")).toBe(false);
  });

  it("survives a job with no discard method", () => {
    const job = { id: "9", data: { type: "x", event: "y" } };
    beginJob("9", job);
    expect(() => cancelJob("9")).not.toThrow();
  });

  it("derives the cancel channel from the queue name", () => {
    expect(cancelChannel()).toBe("worker-app:cancel");
  });
});
