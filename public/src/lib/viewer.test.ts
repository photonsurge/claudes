const handlers: Record<string, (p: unknown) => void> = {};
jest.mock("./socket-provider", () => ({
  useSocket: () => ({
    socket: {
      on: (ev: string, fn: (p: unknown) => void) => (handlers[ev] = fn),
      off: (ev: string) => delete handlers[ev],
    },
  }),
}));

import { act, renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE, mergeControlState } from "@photonsurge/shared/control";
import { DEFAULT_CHAT_COMMAND_SETTINGS } from "@photonsurge/shared/chat-policy";
import { emptyViewerState, type ViewerRequest, type ViewerState } from "@photonsurge/shared/viewer";
import { composeViewerLayer, fetchViewerState, useViewerPicks, useViewerState } from "./viewer";

const T = Date.UTC(2026, 9, 4, 12);
const pick = (over: Partial<ViewerRequest>): ViewerRequest => ({
  slot: "audioMode",
  value: "deep",
  label: "Deep",
  by: { author: "ann", platform: "sim" },
  requestedAt: T,
  until: T + 60_000,
  holdMs: 60_000,
  ...over,
});

describe("composeViewerLayer", () => {
  const state = DEFAULT_CONTROL_STATE;

  it("returns the channel's state untouched without picks", () => {
    expect(composeViewerLayer(state, {})).toBe(state);
  });

  it("overrides the music mode", () => {
    expect(composeViewerLayer(state, { audioMode: pick({}) }).audio).toEqual({ ...state.audio, mode: "deep" });
  });

  it("applies a built-in palette, clearing the channel's overrides for the hold", () => {
    const branded = mergeControlState(state, { themeOverrides: { accent: "#123456" } });
    const out = composeViewerLayer(branded, { theme: pick({ slot: "theme", value: "storm" }) });
    expect(out.broadcastTheme).toBe("storm");
    expect(out.themeOverrides).toEqual({});
  });

  it("applies one of the channel's own palettes with its overrides", () => {
    const own = mergeControlState(state, {
      chat: { ...state.chat, commands: { ...DEFAULT_CHAT_COMMAND_SETTINGS, theme: { ...DEFAULT_CHAT_COMMAND_SETTINGS.theme, palettes: [{ id: "night", label: "Night", broadcastTheme: "aurora", themeOverrides: { accent: "#0ff" } }] } } },
    });
    const out = composeViewerLayer(own, { theme: pick({ slot: "theme", value: "night" }) });
    expect(out.broadcastTheme).toBe("aurora");
    expect(out.themeOverrides).toEqual({ accent: "#0ff" });
  });

  it("ignores a palette the channel no longer offers", () => {
    expect(composeViewerLayer(state, { theme: pick({ slot: "theme", value: "gone" }) })).toBe(state);
  });
});

describe("useViewerPicks", () => {
  afterEach(() => jest.useRealTimers());

  it("drops a pick at its expiry", () => {
    jest.useFakeTimers({ now: T });
    const s: ViewerState = { ...emptyViewerState("s"), active: { audioMode: pick({}) } };
    const { result } = renderHook(() => useViewerPicks(s));
    expect(result.current.audioMode?.value).toBe("deep");
    act(() => {
      jest.advanceTimersByTime(60_100);
    });
    expect(result.current.audioMode).toBeUndefined();
  });
});

describe("useViewerState", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("cold-starts from the API with the watch token, then follows the socket for its scene only", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...emptyViewerState("s1"), updatedAt: 1 }) });
    const { result } = renderHook(() => useViewerState("s1", "tok"));
    await waitFor(() => expect(result.current?.updatedAt).toBe(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/scenes/s1/viewer?token=tok");
    act(() => handlers["viewer:state"]({ data: { ...emptyViewerState("other"), updatedAt: 9 } }));
    expect(result.current?.sceneId).toBe("s1");
    act(() => handlers["viewer:state"]({ data: { ...emptyViewerState("s1"), audioSeed: 5, updatedAt: 9 } }));
    expect(result.current?.audioSeed).toBe(5);
  });

  it("fetchViewerState is null on failure", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    expect(await fetchViewerState("s1")).toBeNull();
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await fetchViewerState("s1")).toBeNull();
  });
});
