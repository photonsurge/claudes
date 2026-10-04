/**
 * The chat poller's logging contract: every page (including the first/backlog
 * page) is appended to db.chatLog, but only post-start pages are emitted over
 * the relay; a Mongo append failure must never break the live relay; and the
 * tick self-terminates once the run stops being live / chat-enabled.
 */
const monitors = new Map<string, () => Promise<number>>();
jest.mock("./monitor", () => ({
  startMonitor: (key: string, tick: () => Promise<number>) => monitors.set(key, tick),
  stopMonitor: (key: string) => monitors.delete(key),
}));

const emitted: Array<{ type: string; data: { id: string } }> = [];
jest.mock("../socket", () => ({ emitWorkerEvent: (e: never) => emitted.push(e) }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

const mockListChat = jest.fn();
const mockSendChat = jest.fn();
jest.mock("../youtube/client", () => ({
  getYoutubeClient: jest.fn(async () => ({})),
  listChat: (...a: unknown[]) => mockListChat(...a),
  sendChatMessage: (...a: unknown[]) => mockSendChat(...a),
  // Errors thrown by the real client carry their classified `kind`.
  youtubeErrorKind: (e: { kind?: string } | null) => e?.kind ?? "other",
}));

const mockPacing = jest.fn();
jest.mock("../youtube/quota", () => ({
  CHAT_PAUSE_MAX_MS: 600_000,
  chatPacing: (...a: unknown[]) => mockPacing(...a),
  fmtResetTime: () => "07:00 UTC",
}));

const mockCommandReplies = jest.fn();
jest.mock("./chat-commands", () => ({
  commandReplies: (...a: unknown[]) => mockCommandReplies(...a),
  MAX_REPLIES_PER_BATCH: 2,
}));

const mockHandle = jest.fn(async () => ({ replies: [] as string[], replyInChat: false, changed: false }));
jest.mock("./chat-handler", () => ({
  handleChatBatch: (...a: unknown[]) => (mockHandle as any)(...a),
  defaultHandlerDeps: async () => ({}),
}));

const mockGetRun = jest.fn();
const mockAppend = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    getRun: (...a: unknown[]) => mockGetRun(...a),
    chatLog: { append: (...a: unknown[]) => mockAppend(...a) },
  }),
}));

import { startChatPoll, stopChatPoll } from "./chat";

const liveRun = {
  id: "r1",
  sceneId: "main",
  status: "live",
  chat: { enabled: true },
  platforms: { youtube: { accountId: "acct", liveChatId: "chat-1" } },
};

const page = (ids: string[], nextPageToken?: string, pollingIntervalMillis = 4_000) => ({
  messages: ids.map((id) => ({ id, author: "ann", text: `msg ${id}`, ts: 1_000 })),
  nextPageToken,
  pollingIntervalMillis,
});

const tick = () => monitors.get("chat:r1")!();

beforeEach(() => {
  monitors.clear();
  emitted.length = 0;
  mockGetRun.mockReset().mockResolvedValue(liveRun);
  mockAppend.mockReset().mockResolvedValue(1);
  mockListChat.mockReset();
  mockSendChat.mockReset().mockResolvedValue(undefined);
  mockCommandReplies.mockReset().mockResolvedValue([]);
  mockPacing.mockReset().mockResolvedValue({ floorMs: 0 });
  mockHandle.mockReset().mockResolvedValue({ replies: [], replyInChat: false, changed: false });
  stopChatPoll("r1"); // clear any page token left by a previous test
  stopChatPoll("r2");
  startChatPoll("r1");
});

it("self-terminates when the run is gone or no longer live/chat-enabled", async () => {
  mockGetRun.mockResolvedValue(null);
  expect(await tick()).toBe(-1);
  mockGetRun.mockResolvedValue({ ...liveRun, status: "ended" });
  expect(await tick()).toBe(-1);
  mockGetRun.mockResolvedValue({ ...liveRun, chat: { enabled: false } });
  expect(await tick()).toBe(-1);
});

it("waits (without terminating) while the liveChatId hasn't resolved yet", async () => {
  mockGetRun.mockResolvedValue({ ...liveRun, platforms: { youtube: { accountId: "acct" } } });
  expect(await tick()).toBe(5_000);
  expect(mockListChat).not.toHaveBeenCalled();
});

it("logs the backlog page but does not emit it", async () => {
  mockListChat.mockResolvedValue(page(["m1", "m2"], "tok-2"));
  expect(await tick()).toBe(4_000);
  expect(mockListChat).toHaveBeenCalledWith({}, "chat-1", undefined);
  expect(mockAppend).toHaveBeenCalledTimes(1);
  const appended = mockAppend.mock.calls[0][0];
  expect(appended.map((m: { id: string }) => m.id)).toEqual(["m1", "m2"]);
  expect(appended[0]).toMatchObject({ runId: "r1", sceneId: "main", platform: "youtube", text: "msg m1" });
  expect(emitted).toHaveLength(0);
});

it("logs AND emits subsequent pages, continuing from the stored page token", async () => {
  mockListChat.mockResolvedValueOnce(page([], "tok-2"));
  await tick();
  mockListChat.mockResolvedValueOnce(page(["m3"], "tok-3"));
  expect(await tick()).toBe(4_000);
  expect(mockListChat).toHaveBeenLastCalledWith({}, "chat-1", "tok-2");
  expect(mockAppend).toHaveBeenCalledTimes(1); // empty backlog page skips append
  expect(emitted).toHaveLength(1);
  expect(emitted[0].data.id).toBe("m3");
});

it("still emits when the log append fails", async () => {
  mockListChat.mockResolvedValueOnce(page([], "tok-2"));
  await tick();
  mockAppend.mockRejectedValue(new Error("mongo down"));
  mockListChat.mockResolvedValueOnce(page(["m4"], "tok-3"));
  expect(await tick()).toBe(4_000); // not the 5s error backoff
  expect(emitted).toHaveLength(1);
  expect(emitted[0].data.id).toBe("m4");
});

it("posts command replies for fresh pages — but never answers the backlog", async () => {
  mockCommandReplies.mockResolvedValue(["Map modes: …"]);
  mockListChat.mockResolvedValueOnce(page(["m1"], "tok-2"));
  await tick(); // backlog page
  expect(mockCommandReplies).not.toHaveBeenCalled();
  expect(mockSendChat).not.toHaveBeenCalled();

  mockListChat.mockResolvedValueOnce(page(["m2"], "tok-3"));
  await tick();
  expect(mockCommandReplies).toHaveBeenCalledTimes(1);
  const [runArg, msgsArg] = mockCommandReplies.mock.calls[0];
  expect(runArg.id).toBe("r1");
  expect(msgsArg.map((m: { id: string }) => m.id)).toEqual(["m2"]);
  expect(mockSendChat).toHaveBeenCalledWith({}, "chat-1", "Map modes: …");
});

it("a failed reply send doesn't break the poll", async () => {
  mockListChat.mockResolvedValueOnce(page([], "tok-2"));
  await tick();
  mockCommandReplies.mockResolvedValue(["hi"]);
  mockSendChat.mockRejectedValue(new Error("insufficient scope"));
  mockListChat.mockResolvedValueOnce(page(["m2"], "tok-3"));
  expect(await tick()).toBe(4_000); // not the 5s error backoff
  expect(emitted).toHaveLength(1); // relay already happened
});

it("clamps the poll interval to at least 2s and backs off 5s on API errors", async () => {
  mockListChat.mockResolvedValueOnce(page([], "tok-2", 500));
  expect(await tick()).toBe(2_000);
  mockListChat.mockRejectedValueOnce(new Error("quota"));
  expect(await tick()).toBe(5_000);
});

describe("quota pacing", () => {
  it("stretches the poll interval to the quota-derived floor", async () => {
    mockPacing.mockResolvedValue({ floorMs: 60_000 });
    mockListChat.mockResolvedValueOnce(page([], "tok-2", 4_000));
    expect(await tick()).toBe(60_000);
  });

  it("pauses WITHOUT calling the API once the budget is spent, and logs once", async () => {
    mockPacing.mockResolvedValue({ floorMs: 3_600_000, pauseMs: 600_000 });
    expect(await tick()).toBe(600_000);
    expect(await tick()).toBe(600_000);
    expect(mockListChat).not.toHaveBeenCalled();
    const { log } = jest.requireMock("@photonsurge/shared/utill/logger");
    expect(log.mock.calls.filter((c: string[]) => /chat poll paused/.test(c[1])).length).toBe(1);
  });

  it("splits the budget across the runs currently polling", async () => {
    startChatPoll("r2");
    mockListChat.mockResolvedValueOnce(page([], "tok-2"));
    await tick();
    expect(mockPacing).toHaveBeenLastCalledWith("acct", 2);
  });

  it("backs off by error kind: spent quota sleeps toward the reset, dead token waits for a reconnect, blips retry soon", async () => {
    mockListChat.mockRejectedValueOnce(Object.assign(new Error("quota gone"), { kind: "quota", resetAt: Date.now() + 2 * 3_600_000 }));
    expect(await tick()).toBe(600_000); // capped at CHAT_PAUSE_MAX_MS
    mockListChat.mockRejectedValueOnce(Object.assign(new Error("quota gone"), { kind: "quota", resetAt: Date.now() + 60_000 }));
    expect(await tick()).toBeLessThanOrEqual(60_000);
    mockListChat.mockRejectedValueOnce(Object.assign(new Error("revoked"), { kind: "auth-revoked" }));
    expect(await tick()).toBe(5 * 60_000);
    mockListChat.mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { kind: "network" }));
    expect(await tick()).toBe(15_000);
    mockListChat.mockRejectedValueOnce(Object.assign(new Error("slow"), { kind: "timeout" }));
    expect(await tick()).toBe(15_000);
  });

  it("a repeating failure logs once per kind, and a success resets that", async () => {
    const { log } = jest.requireMock("@photonsurge/shared/utill/logger");
    log.mockClear();
    const fail = () => mockListChat.mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { kind: "network" }));
    fail();
    await tick();
    fail();
    await tick();
    expect(log.mock.calls.filter((c: string[]) => /poll error/.test(c[1])).length).toBe(1);
    mockListChat.mockResolvedValueOnce(page([], "tok-2"));
    await tick();
    fail();
    await tick();
    expect(log.mock.calls.filter((c: string[]) => /poll error/.test(c[1])).length).toBe(2);
  });
});

it("hands fresh messages to the viewer handler, and posts its replies only when the channel replies in chat", async () => {
  mockGetRun.mockResolvedValue(liveRun);
  mockPacing.mockResolvedValue({ floorMs: 0 });
  mockCommandReplies.mockResolvedValue([]);
  mockListChat.mockResolvedValueOnce(page(["m1"], "t1")).mockResolvedValueOnce(page(["m2"], "t2")).mockResolvedValueOnce(page(["m3"], "t3"));
  startChatPoll("r1");
  const tick = monitors.get("chat:r1")!;
  await tick(); // backlog page: never answered
  expect(mockHandle).not.toHaveBeenCalled();

  mockHandle.mockResolvedValueOnce({ replies: ["@ann → Deep for 5 min"], replyInChat: false, changed: true });
  await tick();
  expect((mockHandle.mock.calls[0] as unknown[])[0]).toBe("main");
  expect(mockSendChat).not.toHaveBeenCalled();

  mockHandle.mockResolvedValueOnce({ replies: ["@ann → Deep for 5 min"], replyInChat: true, changed: true });
  await tick();
  expect(mockSendChat).toHaveBeenCalledWith({}, "chat-1", "@ann → Deep for 5 min");
  stopChatPoll("r1");
});
