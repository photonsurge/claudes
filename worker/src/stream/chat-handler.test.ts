jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));

import type { AppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_CHAT_COMMAND_SETTINGS, type ChatCommandSettings } from "@photonsurge/shared/chat-policy";
import { emptyViewerState, type ViewerState } from "@photonsurge/shared/viewer";
import { handleChatBatch, helpText, resetChatHandlerCooldowns, type ChatInput, type HandlerDeps } from "./chat-handler";

const T = 50_000_000;

function setup(policy: Partial<ChatCommandSettings> = {}, chatEnabled = true) {
  let stored: ViewerState = emptyViewerState("s1");
  const scene = {
    ...DEFAULT_CONTROL_STATE,
    chat: { enabled: chatEnabled, promoteToTicker: false, commands: { ...DEFAULT_CHAT_COMMAND_SETTINGS, enabled: true, ...policy } },
  };
  const db = {
    getScene: jest.fn(async () => scene),
    getOrInitBroadcastState: jest.fn(async () => scene),
    viewerState: {
      get: jest.fn(async () => stored),
      save: jest.fn(async (s: ViewerState) => {
        stored = s;
      }),
    },
  } as unknown as AppDb;
  const emit = jest.fn();
  const deps: HandlerDeps = { db, emit };
  return { deps, emit, db, stored: () => stored };
}
const say = (text: string, over: Partial<ChatInput> = {}): ChatInput => ({ author: "ann", text, platform: "sim", ...over });

beforeEach(() => resetChatHandlerCooldowns());

describe("handleChatBatch — gates", () => {
  it("does nothing when chat isn't monitored or commands are off", async () => {
    const off = setup({}, false);
    expect(await handleChatBatch("s1", [say(":music deep")], off.deps, T)).toEqual({ replies: [], replyInChat: false, changed: false });
    const noCommands = setup({ enabled: false });
    const res = await handleChatBatch("s1", [say(":music deep")], noCommands.deps, T);
    expect(res.replies).toEqual([]);
    expect(noCommands.emit).not.toHaveBeenCalled();
  });

  it("ignores authors the policy doesn't allow", async () => {
    const mods = setup({ allowFrom: "mods" });
    expect((await handleChatBatch("s1", [say(":music deep")], mods.deps, T)).replies).toEqual([]);
    expect((await handleChatBatch("s1", [say(":music deep", { isMod: true })], mods.deps, T)).replies).toHaveLength(1);
  });

  it("leaves the always-on info commands and chatter to the poller", async () => {
    const { deps } = setup();
    const res = await handleChatBatch("s1", [say(":help"), say(":modes"), say(":mode"), say("hello")], deps, T);
    expect(res.replies).toEqual([]);
  });
});

describe("handleChatBatch — music", () => {
  it("puts a music pick on air with the default hold, saves and emits it", async () => {
    const { deps, emit, stored } = setup();
    const res = await handleChatBatch("s1", [say(":music deep")], deps, T);
    expect(res).toEqual({ replies: ["@ann → Deep for 5 min"], replyInChat: false, changed: true });
    expect(stored().active.audioMode).toMatchObject({ value: "deep", label: "Deep", until: T + 300_000, by: { author: "ann", platform: "sim" } });
    expect(emit).toHaveBeenCalledWith(stored());
  });

  it("honours the viewer's minutes up to the max", async () => {
    const { deps, stored } = setup({ music: { ...DEFAULT_CHAT_COMMAND_SETTINGS.music, maxHoldS: 600 } });
    await handleChatBatch("s1", [say(":music chill 30")], deps, T);
    expect(stored().active.audioMode?.holdMs).toBe(600_000);
  });

  it("lists the modes, and refuses one that isn't allowed", async () => {
    const { deps } = setup({ music: { ...DEFAULT_CHAT_COMMAND_SETTINGS.music, allowed: ["deep", "chill"] } });
    const res = await handleChatBatch("s1", [say(":music"), say(":music breaks", { author: "bob" })], deps, T);
    expect(res.replies).toEqual(["Music: deep · chill", '@bob "breaks" isn\'t a music mode here — try :music']);
  });

  it("queues a second pick behind the first, and says so", async () => {
    const { deps, stored } = setup();
    const res = await handleChatBatch("s1", [say(":music deep"), say(":music chill", { author: "bob" })], deps, T);
    expect(res.replies[1]).toBe("@bob → Chill is queued (#1)");
    expect(stored().queue).toHaveLength(1);
  });

  it("refuses when the queue is full", async () => {
    const { deps } = setup({ maxQueued: 1 });
    const res = await handleChatBatch("s1", [say(":music deep"), say(":music chill", { author: "b" }), say(":music lounge", { author: "c" })], deps, T);
    expect(res.replies[2]).toBe("@c the queue is full, try again in a minute");
  });

  it("applies the per-viewer cooldown to requests", async () => {
    const { deps } = setup({ perUserCooldownS: 60 });
    await handleChatBatch("s1", [say(":music deep")], deps, T);
    expect((await handleChatBatch("s1", [say(":music chill")], deps, T + 1_000)).replies).toEqual([]);
    expect((await handleChatBatch("s1", [say(":music chill")], deps, T + 61_000)).replies).toHaveLength(1);
  });

  it("is silent when music requests are off", async () => {
    const { deps } = setup({ music: { ...DEFAULT_CHAT_COMMAND_SETTINGS.music, enabled: false } });
    expect((await handleChatBatch("s1", [say(":music deep"), say(":skip", { author: "b" })], deps, T)).replies).toEqual([]);
  });
});

describe("handleChatBatch — skip / shuffle", () => {
  it("bumps the skip epoch, with a channel-wide cooldown", async () => {
    const { deps, stored } = setup({ perUserCooldownS: 0 });
    await handleChatBatch("s1", [say(":skip")], deps, T);
    expect(stored().audioSkipEpoch).toBe(1);
    await handleChatBatch("s1", [say(":skip", { author: "bob" })], deps, T + 5_000);
    expect(stored().audioSkipEpoch).toBe(1);
    await handleChatBatch("s1", [say(":skip", { author: "bob" })], deps, T + 31_000);
    expect(stored().audioSkipEpoch).toBe(2);
  });

  it("reseeds on shuffle, and respects the switches", async () => {
    const { deps, stored } = setup();
    await handleChatBatch("s1", [say(":shuffle")], deps, T);
    expect(stored().audioSeed).toBeGreaterThan(0);
    const noSkip = setup({ music: { ...DEFAULT_CHAT_COMMAND_SETTINGS.music, allowSkip: false } });
    expect((await handleChatBatch("s1", [say(":skip")], noSkip.deps, T)).replies).toEqual([]);
  });
});

describe("handleChatBatch — palettes, queue, reset", () => {
  it("picks a built-in palette by id or name", async () => {
    const { deps, stored } = setup();
    const res = await handleChatBatch("s1", [say(":theme Storm 2")], deps, T);
    expect(res.replies).toEqual(["@ann → Storm for 2 min"]);
    expect(stored().active.theme).toMatchObject({ value: "storm", holdMs: 120_000 });
  });

  it("lists palettes, and refuses an unknown one", async () => {
    const { deps } = setup();
    const res = await handleChatBatch("s1", [say(":themes"), say(":theme disco", { author: "b" })], deps, T);
    expect(res.replies).toEqual(["Themes: command · aurora · storm", '@b "disco" isn\'t a theme here — try :themes']);
  });

  it("reports the queue", async () => {
    const { deps } = setup();
    expect((await handleChatBatch("s1", [say(":queue")], deps, T)).replies).toEqual(["Nothing requested right now"]);
    await handleChatBatch("s1", [say(":music deep"), say(":music chill", { author: "bob" })], deps, T);
    expect((await handleChatBatch("s1", [say(":queue", { author: "c" })], deps, T)).replies).toEqual(["Now: Deep (@ann, 5 min left) · next: Chill"]);
  });

  it("lets only a mod reset", async () => {
    const { deps, stored } = setup();
    await handleChatBatch("s1", [say(":music deep")], deps, T);
    await handleChatBatch("s1", [say(":reset", { author: "b" })], deps, T);
    expect(stored().active.audioMode).toBeDefined();
    await handleChatBatch("s1", [say(":reset", { author: "m", isMod: true })], deps, T);
    expect(stored().active).toEqual({});
  });
});

describe("handleChatBatch — director hook", () => {
  it("hands unknown commands to the director hook and returns its reply", async () => {
    const { deps } = setup();
    deps.director = jest.fn(async () => "@ann → Japan at the next shot change");
    const res = await handleChatBatch("s1", [say(":show japan")], deps, T);
    expect(res.replies).toEqual(["@ann → Japan at the next shot change"]);
    expect((deps.director as jest.Mock).mock.calls[0][0]).toMatchObject({ sceneId: "s1", parsed: { cmd: "show", args: ["japan"] } });
  });
});

describe("helpText", () => {
  it("lists only what the channel allows", () => {
    const base = { ...DEFAULT_CHAT_COMMAND_SETTINGS, enabled: true };
    expect(helpText(base)).toBe("Commands: :modes · :mode · :music <mode> [min] · :skip · :shuffle · :theme <name> [min] · :queue");
    expect(helpText({ ...base, music: { ...base.music, enabled: false }, director: { ...base.director, enabled: true } })).toBe(
      "Commands: :modes · :mode · :theme <name> [min] · :show <place> · :roundup [place] · :mode <look> · :queue",
    );
  });
});

describe("handleChatBatch — a crossword scene (crossword plan §6.4)", () => {
  function crossword() {
    const s = setup({ replyInChat: true });
    (s.db.getScene as jest.Mock).mockResolvedValue({ ...DEFAULT_CONTROL_STATE, id: "xw", surface: "crossword" });
    const hook = jest.fn(async () => undefined);
    return { ...s, hook, deps: { ...s.deps, crossword: hook, coalesce: jest.fn((m: ChatInput[]) => m.slice(0, 1)) } };
  }

  it("hands the raw batch to the crossword consumer: no globe commands, no replies", async () => {
    const { deps, hook, db, emit } = crossword();
    const batch = [
      say("cat", { platform: "youtube", authorChannelId: "UC1", ts: 5 }),
      say(":music deep", { author: "bob" }),
      say("7a rode", { author: "cy", platform: "youtube", authorChannelId: "UC3", ts: 6 }),
    ];
    expect(await handleChatBatch("xw", batch, deps, T)).toEqual({ replies: [], replyInChat: false, changed: false });
    expect(hook).toHaveBeenCalledWith("xw", batch, T);
    expect(deps.coalesce).not.toHaveBeenCalled();
    expect(db.viewerState.get).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("does not need the scene's command policy to be on", async () => {
    const { deps, hook, db } = crossword();
    (db.getScene as jest.Mock).mockResolvedValue({ id: "xw", surface: "crossword", chat: { enabled: false } });
    await handleChatBatch("xw", [say("cat")], deps, T);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("a globe scene never reaches the crossword consumer, and gets the coalesced batch", async () => {
    const { deps, hook, db } = crossword();
    (db.getScene as jest.Mock).mockResolvedValue({
      ...DEFAULT_CONTROL_STATE,
      chat: { enabled: true, promoteToTicker: false, commands: { ...DEFAULT_CHAT_COMMAND_SETTINGS, enabled: true } },
    });
    const res = await handleChatBatch("s1", [say(":music deep"), say(":music chill", { author: "bob" })], deps, T);
    expect(hook).not.toHaveBeenCalled();
    expect(deps.coalesce).toHaveBeenCalledTimes(1);
    expect(res.replies).toEqual(["@ann → Deep for 5 min"]);
  });
});
