import type { PuzzleRow } from "../puzzles/api";
import { deskReason } from "./deskReason";

const row = (id: string, o: Partial<PuzzleRow> = {}): PuzzleRow => ({
  id,
  title: `Puzzle ${id}`,
  status: "ready",
  familyFriendly: true,
  source: "bank",
  createdAt: 1,
  width: 5,
  height: 5,
  words: 10,
  plays: 0,
  scenes: [],
  playLog: [],
  ...o,
});
const play = (at: number, sceneId = "xw") => ({ sceneId, startedAt: at });
const base = { sceneId: "xw", title: "Puzzle a", config: { familyFriendlyOnly: true, noRepeatPuzzles: 2 } };

describe("deskReason: idle", () => {
  it("no ready puzzles", () => {
    expect(deskReason({ ...base, phase: "idle", puzzles: [row("a", { status: "rejected" })] })).toMatch(/no ready puzzles/);
  });
  it("no family-friendly ready puzzle, only when the channel asks for them", () => {
    const puzzles = [row("a", { familyFriendly: false })];
    expect(deskReason({ ...base, phase: "idle", puzzles })).toMatch(/family-friendly puzzles only/);
    expect(deskReason({ ...base, phase: "idle", puzzles, config: { familyFriendlyOnly: false, noRepeatPuzzles: 2 } })).toBeNull();
  });
  it("every eligible puzzle inside the no-repeat window", () => {
    const puzzles = [row("a", { playLog: [play(1)] }), row("b", { playLog: [play(2)] })];
    expect(deskReason({ ...base, phase: "idle", puzzles })).toMatch(/within its last 2 puzzles/);
  });
  it("nothing to say when a puzzle is unplayed or outside the window", () => {
    expect(deskReason({ ...base, phase: "idle", puzzles: [row("a", { playLog: [play(1)] }), row("b")] })).toBeNull();
    const puzzles = [row("a", { playLog: [play(1)] }), row("b", { playLog: [play(2)] }), row("c", { playLog: [play(3)] })];
    expect(deskReason({ ...base, phase: "idle", puzzles })).toBeNull();
  });
  it("plays on other channels do not count", () => {
    expect(deskReason({ ...base, phase: "idle", puzzles: [row("a", { playLog: [play(1, "other")] })] })).toBeNull();
  });
});

describe("deskReason: replaying", () => {
  it("when the puzzle on air has an earlier play here", () => {
    const puzzles = [row("a", { playLog: [play(1), play(2)] })];
    expect(deskReason({ ...base, phase: "playing", puzzles })).toMatch(/Replaying/);
  });
  it("not on its first play, nor when the other plays were elsewhere", () => {
    expect(deskReason({ ...base, phase: "playing", puzzles: [row("a", { playLog: [play(1)] })] })).toBeNull();
    expect(deskReason({ ...base, phase: "playing", puzzles: [row("a", { playLog: [play(1), play(2, "other")] })] })).toBeNull();
  });
  it("uses the defaults while the config is unknown", () => {
    expect(deskReason({ ...base, config: null, phase: "idle", puzzles: [row("a", { familyFriendly: false })] })).toMatch(/family-friendly/);
  });
});
