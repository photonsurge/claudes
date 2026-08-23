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
}));

const mockCommandReplies = jest.fn();
jest.mock("./chat-commands", () => ({
  commandReplies: (...a: unknown[]) => mockCommandReplies(...a),
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
  stopChatPoll("r1"); // clear any page token left by a previous test
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
