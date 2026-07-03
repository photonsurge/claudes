import { BroadcastStateSchema } from "./broadcast-state-model";
import { DEFAULT_CONTROL_STATE } from "../control";

describe("BroadcastStateSchema", () => {
  // Guards the persist path: the schema is strict (Mongoose default), so any
  // ControlState field missing here is SILENTLY dropped on write — the operator
  // sees it work live over the socket, then it reverts on every cold start.
  // (This exact bug shipped for zoomDrift…broadcastTheme and the audio bed.)
  it("persists every ControlState field (strict mode drops unknown keys)", () => {
    const persisted = new Set(Object.keys(BroadcastStateSchema.paths).map((p) => p.split(".")[0]));
    const missing = Object.keys(DEFAULT_CONTROL_STATE).filter((k) => !persisted.has(k));
    expect(missing).toEqual([]);
  });
});
