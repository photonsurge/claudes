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

  // Scene metadata lives on the same doc beside ControlState — the same strict
  // schema drops it just as silently.
  it("persists the scene metadata fields (name, watchToken, hidden, surface)", () => {
    const persisted = new Set(Object.keys(BroadcastStateSchema.paths));
    expect(["name", "watchToken", "hidden", "surface"].filter((k) => !persisted.has(k))).toEqual([]);
  });

  it("keeps hidden and surface out of ControlState (scene metadata, not broadcast state)", () => {
    expect(DEFAULT_CONTROL_STATE).not.toHaveProperty("hidden");
    expect(DEFAULT_CONTROL_STATE).not.toHaveProperty("surface");
  });

  it("surface has no default, so a legacy doc reads as globe", () => {
    expect((BroadcastStateSchema.path("surface") as any).defaultValue).toBeUndefined();
  });
});
