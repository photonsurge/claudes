jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("./candidates", () => ({ buildCandidates: jest.fn(), buildAdSegment: jest.fn(async () => null) }));

import { emitWorkerEvent } from "../socket";
import { getAppDb } from "@photonsurge/shared/db/index";
import { buildCandidates } from "./candidates";
import { startDirector, stopDirector } from "./loop";
import { DEFAULT_DIRECTOR_CONFIG, type DirectorMode, type DirectorState } from "@photonsurge/shared/director";

const emitted = emitWorkerEvent as jest.Mock;
const states = (): DirectorState[] => emitted.mock.calls.map((c) => c[0].data);

/** One scene whose mode the test flips; the loop reads it through the two scene lists. */
function fakeDb(mode: { current: DirectorMode }) {
  return {
    autoDirectorScenes: jest.fn(async () => (mode.current === "auto" ? ["main"] : [])),
    scriptDirectorScenes: jest.fn(async () => (mode.current === "script" ? ["main"] : [])),
    getOrInitDirectorConfig: jest.fn(async () => ({ ...DEFAULT_DIRECTOR_CONFIG, mode: mode.current })),
    airLog: {
      startRun: jest.fn(async () => "run1"),
      recordCut: jest.fn(async () => undefined),
      endRun: jest.fn(async () => undefined),
    },
    ads: { markShown: jest.fn(), recordImpression: jest.fn() },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  emitted.mockClear();
  (buildCandidates as jest.Mock).mockImplementation(async () => [
    { score: 50, segment: { id: "quake:q1", kind: "quake", title: "q1", camera: { center: [1, 2], zoom: 5 }, patch: {}, holdMs: 60_000 } },
  ]);
});

afterEach(() => {
  stopDirector();
  jest.useRealTimers();
});

async function leaveAutoFor(next: DirectorMode) {
  const mode = { current: "auto" as DirectorMode };
  const db = fakeDb(mode);
  (getAppDb as jest.Mock).mockResolvedValue(db);
  startDirector();
  await jest.advanceTimersByTimeAsync(1_000);
  expect(states().filter((s) => s.active)).toHaveLength(1);
  mode.current = next;
  await jest.advanceTimersByTimeAsync(1_000);
  return db;
}

describe("auto loop — a scene leaving auto", () => {
  it("emits the stand-down and closes the as-run run when switched off", async () => {
    const db = await leaveAutoFor("off");
    expect(states().some((s) => !s.active && s.sceneId === "main")).toBe(true);
    expect(db.airLog.endRun).toHaveBeenCalledWith("run1", expect.any(Date));
  });

  it("skips the stand-down for a switch straight to script, but still closes the run", async () => {
    const db = await leaveAutoFor("script");
    expect(states().some((s) => !s.active)).toBe(false);
    expect(db.airLog.endRun).toHaveBeenCalledWith("run1", expect.any(Date));
  });
});
