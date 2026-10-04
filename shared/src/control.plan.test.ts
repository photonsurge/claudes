import mongoose from "mongoose";
import {
  DEFAULT_CONTROL_STATE,
  DEFAULT_YOUTUBE_SETTINGS,
  MAIN_SCENE_ID,
  mergeControlState,
  outputPath,
  type SceneSurface,
} from "./control";
import { BroadcastStateSchema, getBroadcastStateModel } from "./db/broadcast-state-model";

/**
 * Written from docs/crossword-mode-plan.md §3, §9 and §10 (the shared lines of
 * §12), not from the code: the channel's surface, the one helper that knows
 * which page a channel uses, and the YouTube channel a channel record stores.
 */

const conn = mongoose.createConnection();
afterAll(async () => {
  await conn.destroy().catch(() => undefined);
});

describe("outputPath (§3)", () => {
  it("a weather channel's page is /watch/<id>", () => {
    expect(outputPath({ id: "atlantic", surface: "globe" })).toBe("/watch/atlantic");
  });

  it("a crossword channel's page is /crossword/<id>, outside /watch", () => {
    const p = outputPath({ id: "words", surface: "crossword" });
    expect(p).toBe("/crossword/words");
    expect(p.startsWith("/watch")).toBe(false);
  });

  it("missing surface means globe (no migration)", () => {
    expect(outputPath({ id: "old" })).toBe("/watch/old");
  });

  it("the main scene is a weather channel", () => {
    expect(outputPath({ id: MAIN_SCENE_ID })).toBe(`/watch/${MAIN_SCENE_ID}`);
  });

  it("an unknown surface reads as globe", () => {
    expect(outputPath({ id: "x", surface: "bogus" as SceneSurface })).toBe("/watch/x");
  });

  it("carries no token and keeps the id url-safe", () => {
    const p = outputPath({ id: "a b/c?token=x", surface: "crossword" });
    expect(p).toBe(`/crossword/${encodeURIComponent("a b/c?token=x")}`);
    expect(outputPath({ id: "words", surface: "crossword" })).not.toMatch(/token/);
  });
});

describe("surface is scene metadata (§3)", () => {
  it("is not a ControlState field", () => {
    expect(DEFAULT_CONTROL_STATE).not.toHaveProperty("surface");
  });

  it("the strict broadcast-state schema keeps it (schema parity)", () => {
    expect(BroadcastStateSchema.path("surface")).toBeDefined();
    const M = getBroadcastStateModel(conn);
    const doc = new M({ id: "words", name: "Words", surface: "crossword" }).toObject();
    expect(doc.surface).toBe("crossword");
  });

  it("has no default, so a legacy document reads as globe", () => {
    const M = getBroadcastStateModel(conn);
    const doc = new M({ id: "legacy" }).toObject();
    expect(doc.surface).toBeUndefined();
    expect(outputPath({ id: "legacy", surface: doc.surface })).toBe("/watch/legacy");
  });

  it("accepts only globe or crossword", () => {
    const M = getBroadcastStateModel(conn);
    expect(new M({ id: "a", surface: "globe" }).validateSync()?.errors?.surface).toBeUndefined();
    expect(new M({ id: "b", surface: "chess" }).validateSync()?.errors?.surface).toBeDefined();
  });
});

describe("youtube.accountId on the channel record (§10)", () => {
  it("is part of the YouTube settings, empty by default", () => {
    expect(DEFAULT_YOUTUBE_SETTINGS).toHaveProperty("accountId", "");
    expect(DEFAULT_CONTROL_STATE.youtube).toHaveProperty("accountId", "");
  });

  it("the strict broadcast-state schema keeps it beside title, description and thumbnail (schema parity)", () => {
    expect(BroadcastStateSchema.path("youtube.accountId")).toBeDefined();
    const M = getBroadcastStateModel(conn);
    const youtube = { title: "Crossword %d", description: "Play along", thumbnailUrl: "/t.png", accountId: "acc-xw" };
    const doc = new M({ id: "words", surface: "crossword", youtube }).toObject();
    expect(doc.youtube).toEqual(youtube);
  });

  it("an old document without one reads as none stored", () => {
    const M = getBroadcastStateModel(conn);
    const doc = new M({ id: "old", youtube: { title: "T", description: "", thumbnailUrl: "" } }).toObject();
    expect(doc.youtube.accountId ?? "").toBe("");
  });

  it("merging a patch sets it and leaves it alone when the patch does not name it", () => {
    const set = mergeControlState(DEFAULT_CONTROL_STATE, {
      youtube: { ...DEFAULT_CONTROL_STATE.youtube, accountId: "acc-xw" },
    });
    expect(set.youtube.accountId).toBe("acc-xw");
    const kept = mergeControlState(set, { youtube: { title: "New" } as never });
    expect(kept.youtube.accountId).toBe("acc-xw");
    expect(kept.youtube.title).toBe("New");
  });

  it("can be cleared (no YouTube channel stored)", () => {
    const set = mergeControlState(DEFAULT_CONTROL_STATE, { youtube: { accountId: "acc-xw" } as never });
    expect(mergeControlState(set, { youtube: { accountId: "" } as never }).youtube.accountId).toBe("");
  });
});
