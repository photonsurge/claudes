import type { AppDb } from "@photonsurge/shared/db/index";
import type { Segment } from "@photonsurge/shared/director";
import { airLogCut } from "./airlog";

const seg = (over: Partial<Segment> = {}): Segment => ({
  id: "storm:breakin-a",
  kind: "storm",
  title: "3 NEW SEVERE WARNINGS",
  camera: { center: [10, 50], zoom: 3.5 },
  patch: {},
  holdMs: 16_000,
  ...over,
});

function fakeDb() {
  const recordCut = jest.fn(async () => undefined);
  return { db: { airLog: { startRun: jest.fn(async () => "run-1"), recordCut } } as unknown as AppDb, recordCut };
}

describe("airLogCut", () => {
  it("records why a break-in jumped the queue and every member of a group", async () => {
    const { db, recordCut } = fakeDb();
    const items = [
      { segmentId: "storm:a", title: "A" },
      { segmentId: "storm:b", title: "B", subtitle: "Bavaria" },
    ];
    await airLogCut(db, { sceneId: "s1", seq: 9 }, seg({ breakIn: { reason: "storm", interrupted: true, items } }), {
      skipRequested: true,
      breaking: true,
      now: 1000,
    });
    const [cut, reason] = recordCut.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(cut).toMatchObject({ breaking: true, breakIn: { reason: "storm", interrupted: true }, breakInItems: items, runId: "run-1" });
    expect(reason).toBe("skipped");
  });

  it("records who ordered a commanded cut, and leaves the fields off an ordinary one", async () => {
    const { db, recordCut } = fakeDb();
    await airLogCut(db, { sceneId: "s1", seq: 1, runId: "run-1" }, seg(), { skipRequested: false, breaking: false, now: 1, command: { source: "viewer", author: "ann" } });
    await airLogCut(db, { sceneId: "s1", seq: 2, runId: "run-1" }, seg(), { skipRequested: false, breaking: false, now: 2 });
    const [first] = recordCut.mock.calls[0] as unknown as [Record<string, unknown>];
    const [second] = recordCut.mock.calls[1] as unknown as [Record<string, unknown>];
    expect(first.command).toEqual({ source: "viewer", author: "ann" });
    for (const k of ["command", "breakIn", "breakInItems"]) expect(k in second).toBe(false);
  });

  it("never throws when the log write fails", async () => {
    const db = { airLog: { startRun: jest.fn(async () => { throw new Error("down"); }) } } as unknown as AppDb;
    await expect(airLogCut(db, { sceneId: "s1", seq: 1 }, seg(), { skipRequested: false, breaking: false, now: 1 })).resolves.toBeUndefined();
  });
});
