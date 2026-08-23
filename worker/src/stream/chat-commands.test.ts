/**
 * Command responder contract: prefix parsing, real answers from the map-type
 * catalog / scene state, the per-run cooldown, and the per-batch reply cap
 * (each insert costs ~50 YouTube quota units, so both limits matter).
 */
const mockGetOrInit = jest.fn();
const mockGetScene = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    getOrInitBroadcastState: (...a: unknown[]) => mockGetOrInit(...a),
    getScene: (...a: unknown[]) => mockGetScene(...a),
  }),
}));

import type { ChatMessage, Run } from "@photonsurge/shared/runs";
import { parseCommand, commandReplies, resetChatCommandCooldowns } from "./chat-commands";

const run = { id: "r1", sceneId: "weather" } as Run;
const msg = (text: string, id = text): ChatMessage => ({
  runId: "r1",
  sceneId: "weather",
  platform: "youtube",
  id,
  author: "ann",
  text,
  ts: 1_000,
});
const NOW = 1_700_000_000_000;

beforeEach(() => {
  resetChatCommandCooldowns();
  mockGetOrInit.mockReset().mockResolvedValue(null);
  mockGetScene.mockReset().mockResolvedValue(null);
});

describe("parseCommand", () => {
  it("accepts both prefixes, any case, surrounding whitespace", () => {
    expect(parseCommand(":modes")).toBe("modes");
    expect(parseCommand("!MODE ")).toBe("mode");
    expect(parseCommand("  :Help")).toBe("help");
  });

  it("ignores plain chatter, URLs-ish text, and prefixed sentences", () => {
    expect(parseCommand("hello there")).toBeNull();
    expect(parseCommand("modes")).toBeNull();
    expect(parseCommand(":modes please")).toBeNull(); // command must stand alone
    expect(parseCommand("")).toBeNull();
  });
});

describe("commandReplies", () => {
  it("answers :modes from the map-type catalog without touching the db", async () => {
    const out = await commandReplies(run, [msg(":modes")], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^Map modes: temp · cloud/);
    expect(out[0]).toContain("ocean:");
    expect(mockGetOrInit).not.toHaveBeenCalled();
  });

  it("answers :mode from the run's scene state (non-main scene → getScene)", async () => {
    mockGetScene.mockResolvedValue({ activeVariable: "rain", showAurora: false, showSatImg: false });
    const out = await commandReplies(run, [msg(":mode")], NOW);
    expect(mockGetScene).toHaveBeenCalledWith("weather");
    expect(out).toEqual(["Now showing: Global Precipitation — Rain & snow rate"]);
  });

  it("recognises overlay-driven looks with no scalar field", async () => {
    mockGetScene.mockResolvedValue({ activeVariable: null, showAurora: true, showSatImg: false });
    const out = await commandReplies(run, [msg("!mode")], NOW);
    expect(out[0]).toMatch(/Aurora/);
  });

  it("ignores unknown commands and plain chatter", async () => {
    const out = await commandReplies(run, [msg(":dance"), msg("what a storm!")], NOW);
    expect(out).toEqual([]);
  });

  it("cools down per run+command, then answers again", async () => {
    expect(await commandReplies(run, [msg(":modes", "a")], NOW)).toHaveLength(1);
    expect(await commandReplies(run, [msg(":modes", "b")], NOW + 10_000)).toEqual([]);
    // A DIFFERENT command inside the window still answers.
    expect(await commandReplies(run, [msg(":help", "c")], NOW + 10_000)).toHaveLength(1);
    expect(await commandReplies(run, [msg(":modes", "d")], NOW + 31_000)).toHaveLength(1);
  });

  it("caps replies per batch", async () => {
    const batch = [msg(":modes", "a"), msg(":help", "b"), msg(":mode", "c")];
    mockGetScene.mockResolvedValue({ activeVariable: "temp" });
    const out = await commandReplies(run, batch, NOW);
    expect(out).toHaveLength(2);
  });

  it("skips just the failing command, not the batch", async () => {
    mockGetScene.mockRejectedValue(new Error("mongo blip"));
    const out = await commandReplies(run, [msg(":mode", "a"), msg(":help", "b")], NOW);
    expect(out).toEqual(["Commands: :modes (all map looks) · :mode (what's on now) · :help"]);
  });
});
