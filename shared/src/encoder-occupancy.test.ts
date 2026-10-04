import { encoderOccupancy, occupancyTime, type OccupancyRun } from "./encoder-occupancy";

const NOW = Date.parse("2026-10-04T13:00:00Z"); // 14:00 London (BST)
const enc = (id: string, extra: Record<string, unknown> = {}) => ({ id, enabled: true, ...extra });

describe("encoderOccupancy", () => {
  it("is free with nothing on it", () => {
    const occ = encoderOccupancy([enc("a")], [], [], [], NOW);
    expect(occ.a).toMatchObject({ state: "free", label: "free", canQueueVideo: true, queued: 0 });
  });

  it("is disabled, greyed out, whatever else is on it", () => {
    const runs: OccupancyRun[] = [{ id: "r", sceneId: "default", encoderId: "a", status: "live" }];
    const occ = encoderOccupancy([enc("a", { enabled: false })], runs, [], [], NOW);
    expect(occ.a).toMatchObject({ state: "disabled", canQueueVideo: false });
  });

  it("is live with a channel run, with since and until for a bounded run", () => {
    const runs: OccupancyRun[] = [
      { id: "r", sceneId: "default", encoderId: "a", status: "live", title: "Main channel", startAt: Date.parse("2026-10-04T13:02:00Z"), durationMs: 30 * 60_000 },
      { id: "old", sceneId: "default", encoderId: "b", status: "ended" },
    ];
    const occ = encoderOccupancy([enc("a"), enc("b")], runs, [], [], NOW);
    expect(occ.a).toMatchObject({ state: "live", canQueueVideo: false, runId: "r" });
    expect(occ.a.label).toBe("live: Main channel, since 14:02, until 14:32");
    expect(occ.b.state).toBe("free"); // a finished run holds nothing
  });

  it("counts a run with no encoderId on the env encoder", () => {
    const runs: OccupancyRun[] = [{ id: "r", sceneId: "default", status: "awaiting-ingest" }];
    expect(encoderOccupancy([enc("env")], runs, [], [], NOW).env.state).toBe("live");
  });

  it("is rendering with a video run, and says how many more are queued", () => {
    const runs: OccupancyRun[] = [
      { id: "r", sceneId: "shorts", encoderId: "v", status: "live", title: "Europe round-up", script: { scriptId: "s", renderId: "x" } },
    ];
    const renders = [
      { id: "x", encoderId: "v", status: "live" as const, runId: "r" },
      { id: "y", encoderId: "v", status: "queued" as const },
      { id: "z", encoderId: "v", status: "queued" as const },
      { id: "w", encoderId: "any", status: "queued" as const },
    ];
    const occ = encoderOccupancy([enc("v")], runs, [], [], NOW, renders);
    expect(occ.v).toMatchObject({ state: "rendering", canQueueVideo: true, renderId: "x", queued: 2 });
    expect(occ.v.label).toBe("rendering: Europe round-up, 2 more queued");
  });

  it("is rendering while a video is being prepared (no run yet)", () => {
    const renders = [{ id: "x", encoderId: "any", assignedEncoderId: "v", status: "preparing" as const }];
    expect(encoderOccupancy([enc("v")], [], [], [], NOW, renders).v).toMatchObject({ state: "rendering", renderId: "x" });
  });

  it("is held by an enabled slot pinned to it, or bound through its scene; a disabled slot holds nothing", () => {
    const slots = [
      { id: "s1", name: "Main", sceneId: "default", encoderId: "a", enabled: true },
      { id: "s2", sceneId: "volcano", enabled: true },
      { id: "s3", sceneId: "atlantic", encoderId: "c", enabled: false },
    ];
    const occ = encoderOccupancy([enc("a"), enc("b", { sceneId: "volcano" }), enc("c")], [], slots, [], NOW);
    expect(occ.a).toMatchObject({ state: "held", label: "held by always-on slot Main", canQueueVideo: false });
    expect(occ.b).toMatchObject({ state: "held", slotId: "s2" });
    expect(occ.c.state).toBe("free");
  });

  it("is booked for the next enabled schedule on it within 24 hours; 'any' schedules book no single encoder", () => {
    const schedules = [
      { id: "far", enabled: true, encoderId: "v", nextAt: NOW + 30 * 3_600_000 },
      { id: "late", enabled: true, encoderId: "v", nextAt: NOW + 6 * 3_600_000 },
      { id: "soon", name: "Morning batch", enabled: true, encoderId: "v", nextAt: NOW + 4 * 3_600_000 },
      { id: "off", enabled: false, encoderId: "v", nextAt: NOW + 3_600_000 },
      { id: "pool", enabled: true, encoderId: "any", nextAt: NOW + 3_600_000 },
    ];
    const occ = encoderOccupancy([enc("v"), enc("w")], [], [], schedules, NOW);
    expect(occ.v).toMatchObject({ state: "booked", scheduleId: "soon", bookedAt: NOW + 4 * 3_600_000, canQueueVideo: true });
    expect(occ.v.label).toBe("free, batch booked 18:00");
    expect(occ.w.state).toBe("free");
  });

  it("formats times in London by default, another zone on request", () => {
    expect(occupancyTime(NOW)).toBe("14:00");
    expect(occupancyTime(NOW, "UTC")).toBe("13:00");
  });
});
