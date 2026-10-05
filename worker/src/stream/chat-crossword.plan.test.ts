/**
 * The live chat poller on a crossword channel (WP8), written from
 * docs/crossword-mode-plan.md §2, §4.5, §6.3 and §6.4 rather than from the
 * code. The real poller, chat handler, info commands, director hook and the
 * crossword's chat consumer run together; YouTube, quota, Mongo and the runner
 * are fakes.
 *
 *  - `authorChannelId` flows from `listChat` through `ChatMessage` into the
 *    chat log;
 *  - on a crossword scene the fresh messages reach the runner directly:
 *    nothing is enqueued and no chat reply is posted (each costs 50 units);
 *  - the backlog page is still skipped;
 *  - `:modes` and `:mode` are skipped on a crossword scene and still answer on
 *    a globe scene;
 *  - a weather (globe) scene's chat path is unchanged: the runner never sees it.
 */
const monitors = new Map<string, () => Promise<number>>();
jest.mock("./monitor", () => ({
  startMonitor: (key: string, tick: () => Promise<number>) => monitors.set(key, tick),
  stopMonitor: (key: string) => monitors.delete(key),
}));

const emitted: Array<{ type: string; data: any }> = [];
jest.mock("../socket", () => ({ emitWorkerEvent: (e: never) => emitted.push(e) }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

const mockListChat = jest.fn();
const mockSendChat = jest.fn();
jest.mock("../youtube/client", () => ({
  CHAT_MESSAGE_MAX_LEN: 200,
  getYoutubeClient: jest.fn(async () => ({})),
  listChat: (...a: unknown[]) => mockListChat(...a),
  sendChatMessage: (...a: unknown[]) => mockSendChat(...a),
  youtubeErrorKind: (e: { kind?: string } | null) => e?.kind ?? "other",
}));

jest.mock("../youtube/quota", () => ({
  CHAT_PAUSE_MAX_MS: 600_000,
  chatPacing: async () => ({ floorMs: 0 }),
  fmtResetTime: () => "07:00 UTC",
}));

const mockSubmit = jest.fn();
jest.mock("../crossword/runner", () => ({
  submitAnswers: (...a: unknown[]) => mockSubmit(...a),
}));

// The Mongo stand-in. Every write the globe path could make is a spy.
let scenes: Record<string, any> = {};
let viewer: any = null;
const mockDb = {
  getRun: jest.fn(),
  getStreamSlot: jest.fn(async () => null),
  chatLog: { append: jest.fn(async (m: unknown[]) => m.length) },
  getScene: jest.fn(async (id: string) => scenes[id] ?? null),
  getOrInitBroadcastState: jest.fn(async () => scenes.main ?? null),
  viewerState: {
    get: jest.fn(async (sceneId: string) => viewer ?? emptyViewerState(sceneId)),
    save: jest.fn(async (s: unknown) => void (viewer = s)),
  },
  getOrInitDirectorConfig: jest.fn(async () => ({ mode: "auto" })),
  directorCommands: {
    enqueue: jest.fn(async () => ({ id: "c1" })),
    pending: jest.fn(async () => []),
    settle: jest.fn(async () => true),
  },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_CHAT_COMMAND_SETTINGS } from "@photonsurge/shared/chat-policy";
import { CHAT_MESSAGE } from "@photonsurge/shared/runs";
import { emptyViewerState } from "@photonsurge/shared/viewer";
import { startChatPoll, stopChatPoll } from "./chat";
import { resetChatCommandCooldowns } from "./chat-commands";
import { resetChatHandlerCooldowns } from "./chat-handler";

/** Chat on, every viewer command allowed and answered in chat — the most a channel could reply. */
const chatty = {
  enabled: true,
  promoteToTicker: false,
  commands: {
    ...DEFAULT_CHAT_COMMAND_SETTINGS,
    enabled: true,
    replyInChat: true,
    perUserCooldownS: 0,
    director: { ...DEFAULT_CHAT_COMMAND_SETTINGS.director, enabled: true },
  },
};
const crosswordScene = { ...DEFAULT_CONTROL_STATE, name: "Crossword", surface: "crossword", chat: chatty };
const globeScene = { ...DEFAULT_CONTROL_STATE, name: "Weather", chat: chatty };

const run = (sceneId: string) => ({
  id: "r1",
  sceneId,
  status: "live",
  chat: { enabled: true },
  platforms: { youtube: { accountId: "acct", liveChatId: "chat-1" } },
});

type Raw = { id: string; author: string; authorChannelId?: string; text: string; ts: number };
const page = (messages: Raw[], nextPageToken = "tok") => ({ messages, nextPageToken, pollingIntervalMillis: 4_000 });
const msg = (id: string, text: string, o: Partial<Raw> = {}): Raw => ({ id, author: `Viewer ${id}`, authorChannelId: `UC_${id}`, text, ts: 1_000, ...o });

const tick = () => monitors.get("chat:r1")!();
/** The backlog page (skipped), then `fresh` as the first live page. */
async function poll(fresh: Raw[], backlog: Raw[] = []) {
  mockListChat.mockResolvedValueOnce(page(backlog, "tok-1"));
  await tick();
  mockListChat.mockResolvedValueOnce(page(fresh, "tok-2"));
  await tick();
}

beforeEach(() => {
  monitors.clear();
  emitted.length = 0;
  viewer = null;
  scenes = { xw: crosswordScene, wx: globeScene };
  jest.clearAllMocks();
  mockListChat.mockReset();
  mockSendChat.mockReset().mockResolvedValue(undefined);
  mockSubmit.mockReset().mockResolvedValue({ running: true, solved: [] });
  resetChatCommandCooldowns();
  resetChatHandlerCooldowns();
  stopChatPoll("r1");
  startChatPoll("r1");
});

describe("authorChannelId: listChat → ChatMessage → chat log", () => {
  test("every logged message keeps the author's channel id, backlog page included", async () => {
    mockDb.getRun.mockResolvedValue(run("xw"));
    await poll([msg("b", "hello")], [msg("a", "earlier")]);
    const logged = mockDb.chatLog.append.mock.calls.flatMap((c: any[]) => c[0]);
    expect(logged.map((m: any) => [m.id, m.authorChannelId])).toEqual([
      ["a", "UC_a"],
      ["b", "UC_b"],
    ]);
  });

  test("the emitted ChatMessage carries it too", async () => {
    mockDb.getRun.mockResolvedValue(run("wx"));
    await poll([msg("b", "hello")]);
    const chat = emitted.filter((e) => e.type === CHAT_MESSAGE);
    expect(chat.map((e) => e.data.authorChannelId)).toEqual(["UC_b"]);
  });

  test("a message with no channel id is logged without one (no invented key)", async () => {
    mockDb.getRun.mockResolvedValue(run("wx"));
    await poll([msg("b", "hello", { authorChannelId: undefined })]);
    const logged = mockDb.chatLog.append.mock.calls.flatMap((c: any[]) => c[0]);
    expect(logged[0].authorChannelId).toBeUndefined();
  });
});

describe("a crossword scene", () => {
  beforeEach(() => mockDb.getRun.mockResolvedValue(run("xw")));

  test("fresh messages reach the runner directly as youtube:<authorChannelId> players with their typed time", async () => {
    await poll([msg("a", "cat", { author: "Ann", ts: 5_000 }), msg("b", "7 across: rode", { author: "Bob", ts: 6_000 })]);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    const [sceneId, answers] = mockSubmit.mock.calls[0];
    expect(sceneId).toBe("xw");
    expect(answers).toEqual([
      expect.objectContaining({ playerId: "youtube:UC_a", name: "Ann", text: "cat", typedAt: 5_000 }),
      expect.objectContaining({ playerId: "youtube:UC_b", name: "Bob", typedAt: 6_000 }),
    ]);
  });

  test("the batch is not coalesced: one viewer's several guesses all reach the runner", async () => {
    await poll([msg("a1", "cat", { authorChannelId: "UC_x" }), msg("a2", "car", { authorChannelId: "UC_x" }), msg("a3", "tad", { authorChannelId: "UC_x" })]);
    expect(mockSubmit.mock.calls[0][1].map((a: any) => a.text)).toEqual(["cat", "car", "tad"]);
  });

  test("nothing is enqueued and no viewer state is written, even for globe commands", async () => {
    await poll([msg("a", "cat"), msg("b", ":show japan"), msg("c", ":music deep"), msg("d", ":next"), msg("e", ":mode aurora")]);
    expect(mockDb.directorCommands.enqueue).not.toHaveBeenCalled();
    expect(mockDb.directorCommands.settle).not.toHaveBeenCalled();
    expect(mockDb.viewerState.save).not.toHaveBeenCalled();
    expect(emitted.filter((e) => e.type !== CHAT_MESSAGE)).toEqual([]);
  });

  test("no chat reply is posted for answers, right or wrong (each reply costs 50 units)", async () => {
    mockSubmit.mockResolvedValue({ running: true, solved: ["1a"] });
    await poll([msg("a", "cat"), msg("b", "wrong"), msg("c", ":show japan"), msg("d", ":music deep")]);
    expect(mockSendChat).not.toHaveBeenCalled();
  });

  test(":modes and :mode are skipped", async () => {
    await poll([msg("a", ":modes"), msg("b", "!mode"), msg("c", ":mode")]);
    expect(mockSendChat).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  test("the backlog page is still skipped: logged, not emitted, not answered", async () => {
    mockListChat.mockResolvedValueOnce(page([msg("a", "cat"), msg("b", ":modes")], "tok-1"));
    await tick();
    expect(mockDb.chatLog.append).toHaveBeenCalledTimes(1);
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockSendChat).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    // The next page is live.
    mockListChat.mockResolvedValueOnce(page([msg("c", "car")], "tok-2"));
    await tick();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit.mock.calls[0][1].map((a: any) => a.text)).toEqual(["car"]);
  });

  test("a runner failure never breaks the poll", async () => {
    mockSubmit.mockRejectedValue(new Error("boom"));
    mockListChat.mockResolvedValueOnce(page([], "tok-1"));
    await tick();
    mockListChat.mockResolvedValueOnce(page([msg("a", "cat")], "tok-2"));
    expect(await tick()).toBe(4_000);
    expect(emitted.filter((e) => e.type === CHAT_MESSAGE)).toHaveLength(1);
  });
});

describe("a weather (globe) scene: the chat path is unchanged", () => {
  beforeEach(() => mockDb.getRun.mockResolvedValue(run("wx")));

  test(":modes and :mode still answer in chat", async () => {
    await poll([msg("a", ":modes"), msg("b", ":mode")]);
    const sent = mockSendChat.mock.calls.map((c) => c[2]).join(" | ");
    expect(sent).toMatch(/Map modes:/);
    expect(sent).toMatch(/Now showing:/);
  });

  test("viewer requests still act on the globe and enqueue director commands; the runner never sees anything", async () => {
    await poll([msg("a", ":music deep"), msg("b", ":show japan"), msg("c", "cat")]);
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockDb.viewerState.save).toHaveBeenCalled();
    expect(mockDb.directorCommands.enqueue).toHaveBeenCalledTimes(1);
    expect(mockDb.directorCommands.enqueue.mock.calls[0][0]).toMatchObject({ sceneId: "wx" });
    // This channel's policy answers in chat.
    expect(mockSendChat).toHaveBeenCalled();
  });
});
