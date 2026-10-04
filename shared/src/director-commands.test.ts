import {
  COMMAND_HOLD_EXTEND_MAX_S,
  COMMAND_HOLD_MAX_S,
  COMMAND_HOLD_MIN_S,
  arbitrate,
  describeOp,
  validateOp,
  type DirectorCommand,
  type DirectorOp,
} from "./director-commands";

const NOW = 1_000_000;
let n = 0;
const cmd = (op: DirectorOp, over: Partial<DirectorCommand> = {}): DirectorCommand => ({
  id: `c${++n}`,
  sceneId: "s1",
  source: { kind: "operator", user: "op@x" },
  cmd: op,
  status: "queued",
  createdAt: NOW - 1000,
  expiresAt: NOW + 60_000,
  ...over,
});

describe("validateOp", () => {
  it("accepts every op shape", () => {
    expect(validateOp({ op: "cut", target: { type: "segment", id: "quake:us1" } })).toEqual({
      op: "cut",
      target: { type: "segment", id: "quake:us1" },
    });
    expect(validateOp({ op: "queue", target: { type: "kind", kind: "storm" }, holdS: 30 })).toEqual({
      op: "queue",
      target: { type: "kind", kind: "storm" },
      holdS: 30,
    });
    expect(validateOp({ op: "skip" })).toEqual({ op: "skip" });
    expect(validateOp({ op: "resume", junk: 1 })).toEqual({ op: "resume" });
    expect(validateOp({ op: "clear" })).toEqual({ op: "clear" });
    expect(validateOp({ op: "pause" })).toEqual({ op: "pause" });
    expect(validateOp({ op: "pause", untilMs: 5 })).toEqual({ op: "pause", untilMs: 5 });
    expect(validateOp({ op: "hold", extendS: 30 })).toEqual({ op: "hold", extendS: 30 });
  });

  it("clamps holds", () => {
    const t = { type: "kind", kind: "quake" };
    expect(validateOp({ op: "cut", target: t, holdS: 1 })).toMatchObject({ holdS: COMMAND_HOLD_MIN_S });
    expect(validateOp({ op: "cut", target: t, holdS: 1e9 })).toMatchObject({ holdS: COMMAND_HOLD_MAX_S });
    expect(validateOp({ op: "hold", extendS: 1e9 })).toEqual({ op: "hold", extendS: COMMAND_HOLD_EXTEND_MAX_S });
  });

  it("rejects malformed ops", () => {
    for (const bad of [
      null,
      "skip",
      [],
      { op: "explode" },
      { op: "cut" },
      { op: "cut", target: { type: "segment", id: "nocolon" } },
      { op: "cut", target: { type: "segment", id: "" } },
      { op: "cut", target: { type: "kind", kind: "dragon" } },
      { op: "cut", target: { type: "kind", kind: "ad" } },
      { op: "cut", target: { type: "place", query: "   " } },
      { op: "cut", target: { type: "place", query: "x".repeat(81) } },
      { op: "cut", target: { type: "kind", kind: "quake" }, holdS: "30" },
      { op: "hold" },
      { op: "hold", extendS: -5 },
      { op: "pause", untilMs: "soon" },
    ]) {
      expect(validateOp(bad)).toBeNull();
    }
  });

  it("trims place and round-up queries", () => {
    expect(validateOp({ op: "cut", target: { type: "place", query: "  japan " } })).toEqual({
      op: "cut",
      target: { type: "place", query: "japan" },
    });
    expect(validateOp({ op: "cut", target: { type: "roundup" } })).toEqual({ op: "cut", target: { type: "roundup" } });
    expect(validateOp({ op: "cut", target: { type: "roundup", place: " uk" } })).toEqual({
      op: "cut",
      target: { type: "roundup", place: "uk" },
    });
  });
});

describe("arbitrate", () => {
  it("expires anything past its time, whatever it is", () => {
    const old = cmd({ op: "skip" }, { expiresAt: NOW });
    const out = arbitrate([old], { now: NOW, atBoundary: false });
    expect(out.expired).toEqual([old]);
    expect(out.control).toEqual([]);
  });

  it("applies every control op, oldest first", () => {
    const a = cmd({ op: "hold", extendS: 30 });
    const b = cmd({ op: "pause" });
    expect(arbitrate([a, b], { now: NOW, atBoundary: false }).control).toEqual([a, b]);
  });

  it("takes the oldest operator cut now; later ones wait", () => {
    const a = cmd({ op: "cut", target: { type: "kind", kind: "quake" } });
    const b = cmd({ op: "cut", target: { type: "kind", kind: "storm" } });
    const out = arbitrate([a, b], { now: NOW, atBoundary: false });
    expect(out.cutNow).toBe(a);
  });

  it("airs a queued command only at a shot boundary", () => {
    const q = cmd({ op: "queue", target: { type: "kind", kind: "quake" } });
    expect(arbitrate([q], { now: NOW, atBoundary: false }).atBoundary).toBeNull();
    expect(arbitrate([q], { now: NOW, atBoundary: true }).atBoundary).toBe(q);
  });

  it("never treats a viewer cut as an immediate operator cut", () => {
    const v = cmd({ op: "cut", target: { type: "kind", kind: "quake" } }, { source: { kind: "viewer", platform: "youtube", author: "ann" } });
    const out = arbitrate([v], { now: NOW, atBoundary: false });
    expect(out.cutNow).toBeNull();
    expect(arbitrate([v], { now: NOW, atBoundary: true }).atBoundary).toBe(v);
  });

  it("ignores rows that are no longer queued", () => {
    const done = cmd({ op: "skip" }, { status: "applied" });
    expect(arbitrate([done], { now: NOW, atBoundary: true })).toEqual({ expired: [], control: [], cutNow: null, atBoundary: null });
  });
});

describe("describeOp", () => {
  it("labels every op for the log", () => {
    expect(describeOp({ op: "cut", target: { type: "segment", id: "quake:x" } })).toBe("Take quake:x");
    expect(describeOp({ op: "queue", target: { type: "kind", kind: "storm" } })).toBe("Next: a storm");
    expect(describeOp({ op: "cut", target: { type: "place", query: "Japan" } })).toBe("Take Japan");
    expect(describeOp({ op: "cut", target: { type: "roundup" } })).toBe("Take world round-up");
    expect(describeOp({ op: "cut", target: { type: "roundup", place: "uk" } })).toBe("Take uk round-up");
    expect(describeOp({ op: "cut", target: { type: "mapType", id: "aurora" } })).toBe("Take aurora map");
    expect(describeOp({ op: "hold", extendS: 30 })).toBe("Hold +30s");
    expect(["skip", "pause", "resume", "clear"].map((op) => describeOp({ op } as DirectorOp))).toEqual([
      "Skip",
      "Pause",
      "Resume",
      "Clear queue",
    ]);
  });
});
