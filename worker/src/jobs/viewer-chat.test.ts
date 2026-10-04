const emitted: { type: string; data: any }[] = [];
jest.mock("../socket", () => ({ emitWorkerEvent: (e: never) => emitted.push(e) }));
const mockHandle = jest.fn();
jest.mock("../stream/chat-handler", () => ({
  handleChatBatch: (...a: unknown[]) => mockHandle(...a),
  defaultHandlerDeps: async () => ({}),
}));
const mockInfo = jest.fn();
jest.mock("../stream/chat-commands", () => ({ commandReplies: (...a: unknown[]) => mockInfo(...a) }));
const mockState = { get: jest.fn(), save: jest.fn() };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => ({ viewerState: mockState }) }));

import { emptyViewerState } from "@photonsurge/shared/viewer";
import { clear, inject } from "./viewer-chat";

const job = (data: Record<string, unknown>) => ({ data: { data } }) as never;

beforeEach(() => {
  emitted.length = 0;
  jest.clearAllMocks();
  mockInfo.mockResolvedValue([]);
  mockHandle.mockResolvedValue({ replies: [], replyInChat: false, changed: false });
});

describe("viewer-chat.inject", () => {
  it("relays the simulated message and the channel's replies to the operator panel only", async () => {
    mockHandle.mockResolvedValue({ replies: ["@tester → Deep for 5 min"], replyInChat: true, changed: true });
    const out = await inject(job({ sceneId: "s1", author: "tester", text: ":music deep", isMod: true }));
    expect(out).toEqual({ sceneId: "s1", replies: ["@tester → Deep for 5 min"] });
    expect(mockHandle.mock.calls[0][1]).toEqual([{ author: "tester", text: ":music deep", isMod: true, platform: "sim" }]);
    expect(emitted.map((e) => [e.type, e.data.runId, e.data.author, e.data.text])).toEqual([
      ["chat:message", "sim:s1", "tester", ":music deep"],
      ["chat:message", "sim:s1", "🤖 channel", "@tester → Deep for 5 min"],
    ]);
  });

  it("answers the info commands the way live chat would", async () => {
    mockInfo.mockResolvedValue(["Map modes: …"]);
    const out = await inject(job({ sceneId: "s1", text: ":modes" }));
    expect(out.replies).toEqual(["Map modes: …"]);
    expect(mockInfo.mock.calls[0][0]).toMatchObject({ id: "sim:s1", sceneId: "s1" });
  });

  it("requires a scene and some text", async () => {
    await expect(inject(job({ sceneId: "s1", text: "  " }))).rejects.toThrow("missing sceneId or text");
    await expect(inject(job({ text: ":music deep" }))).rejects.toThrow("missing sceneId or text");
  });
});

describe("viewer-chat.clear", () => {
  it("clears the scene's picks and emits the new state", async () => {
    mockState.get.mockResolvedValue({ ...emptyViewerState("s1"), queue: [{} as never] });
    await clear(job({ sceneId: "s1" }));
    expect(mockState.save.mock.calls[0][0]).toMatchObject({ sceneId: "s1", active: {}, queue: [] });
    expect(emitted[0]).toMatchObject({ type: "viewer:state", data: { sceneId: "s1" } });
  });
});
