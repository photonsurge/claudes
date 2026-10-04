/**
 * The live page, from the plan (§4.3, §5, §12 public): the state hook follows
 * CROSSWORD_STATE (the socket relay wraps it as `{ type, data }`), refetches the
 * state route when a beat's seq differs from the one on screen; countdowns are
 * drawn from server times corrected by `serverNow`; and the bed's riser fires
 * when a puzzle finishes, not when the page loads into a finale.
 */
import { render, act, screen } from "@testing-library/react";
import { CROSSWORD_BEAT, CROSSWORD_STATE, type CrosswordPublicState } from "@photonsurge/shared/crossword";
import { fakeSocket, finalePub, pub } from "./plan.fixture";

const mockSocket = fakeSocket();
jest.mock("../../lib/socket-provider", () => ({ useSocket: () => ({ socket: mockSocket, connected: true }) }));

// jsdom has no Web Audio: the engine is replaced, the real BroadcastBed runs.
jest.mock("../../lib/audio/engine", () => {
  const instances: unknown[] = [];
  class MockAuroraBed {
    playing = false;
    start = jest.fn(() => {
      this.playing = true;
    });
    stop = jest.fn(() => {
      this.playing = false;
    });
    setMasterVolume = jest.fn();
    setMode = jest.fn();
    setSeverity = jest.fn();
    triggerEvent = jest.fn();
    setWeather = jest.fn();
    resume = jest.fn();
    skip = jest.fn();
    reseed = jest.fn();
    contextState = jest.fn(() => "running");
    constructor() {
      instances.push(this);
    }
  }
  return { AuroraBed: MockAuroraBed, __instances: instances };
});

import CrosswordPage from "./CrosswordPage";
import { useCrosswordState } from "../../lib/crossword";

const risers = () => {
  const { __instances } = jest.requireMock("../../lib/audio/engine") as { __instances: { triggerEvent: jest.Mock }[] };
  return __instances.reduce((n, b) => n + b.triggerEvent.mock.calls.length, 0);
};

let routeState: CrosswordPublicState;
let stateFetches = 0;

function serve() {
  stateFetches = 0;
  global.fetch = jest.fn(async (input: string) => {
    const url = new URL(String(input), "http://x");
    const reply = (status: number, body: unknown = {}) => ({ ok: status < 300, status, json: async () => body });
    if (url.pathname === "/api/scenes/xw") return reply(200, {});
    if (url.pathname === "/api/scenes") return reply(200, { scenes: [{ id: "xw", surface: "crossword" }] });
    if (url.pathname === "/api/crossword/xw/state") {
      stateFetches++;
      return reply(200, { ...routeState, serverNow: routeState.serverNow });
    }
    return reply(404);
  }) as unknown as typeof fetch;
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });

/** What the socket relay sends: the worker event's whole envelope. */
const envelope = (type: string, data: unknown) => ({ type, data, createdAt: Date.now() });

function Probe() {
  const v = useCrosswordState("xw", "good");
  return (
    <div>
      <span data-testid="seq">{v.state ? v.state.seq : "none"}</span>
      <span data-testid="phase">{v.state?.phase ?? "none"}</span>
      <span data-testid="offset">{v.offset}</span>
    </div>
  );
}

beforeEach(() => {
  routeState = pub({ seq: 3 }, { now: Date.now() });
  serve();
});

describe("useCrosswordState", () => {
  it("cold-starts from the state route", async () => {
    render(<Probe />);
    await flush();
    expect(screen.getByTestId("seq").textContent).toBe("3");
    expect(stateFetches).toBeGreaterThanOrEqual(1);
  });

  it("follows CROSSWORD_STATE sent in the relay's { type, data } envelope", async () => {
    render(<Probe />);
    await flush();
    act(() => mockSocket.emit(CROSSWORD_STATE, envelope(CROSSWORD_STATE, pub({ seq: 4, phase: "finale" }, { now: Date.now() }))));
    expect(screen.getByTestId("seq").textContent).toBe("4");
    expect(screen.getByTestId("phase").textContent).toBe("finale");
  });

  it("ignores a state for another scene", async () => {
    render(<Probe />);
    await flush();
    act(() => mockSocket.emit(CROSSWORD_STATE, envelope(CROSSWORD_STATE, { ...pub({ seq: 9 }), sceneId: "other" })));
    expect(screen.getByTestId("seq").textContent).toBe("3");
  });

  it("does not refetch on a beat whose seq matches the screen", async () => {
    render(<Probe />);
    await flush();
    const before = stateFetches;
    await act(async () => {
      mockSocket.emit(CROSSWORD_BEAT, envelope(CROSSWORD_BEAT, { sceneId: "xw", seq: 3, serverNow: Date.now() }));
    });
    await flush();
    expect(stateFetches).toBe(before);
  });

  it("refetches the state route when a beat's seq differs (a missed state)", async () => {
    render(<Probe />);
    await flush();
    const before = stateFetches;
    routeState = pub({ seq: 7 }, { now: Date.now() });
    await act(async () => {
      mockSocket.emit(CROSSWORD_BEAT, envelope(CROSSWORD_BEAT, { sceneId: "xw", seq: 7, serverNow: Date.now() }));
    });
    await flush();
    expect(stateFetches).toBe(before + 1);
    expect(screen.getByTestId("seq").textContent).toBe("7");
  });

  it("ignores a beat for another scene", async () => {
    render(<Probe />);
    await flush();
    const before = stateFetches;
    await act(async () => {
      mockSocket.emit(CROSSWORD_BEAT, envelope(CROSSWORD_BEAT, { sceneId: "other", seq: 99, serverNow: Date.now() }));
    });
    await flush();
    expect(stateFetches).toBe(before);
  });

  it("takes the clock offset from serverNow", async () => {
    routeState = pub({ seq: 3 }, { now: Date.now() + 90_000 });
    render(<Probe />);
    await flush();
    const offset = Number(screen.getByTestId("offset").textContent);
    expect(offset).toBeGreaterThan(89_000);
    expect(offset).toBeLessThan(91_000);
  });
});

describe("countdown", () => {
  it("is drawn from server time, corrected by serverNow", async () => {
    // The server's clock runs 5 minutes ahead of this box; 30 s are left on the clue.
    const serverNow = Date.now() + 300_000;
    routeState = pub({ seq: 3, spotlight: { entryId: "2D", startedAt: serverNow - 30_000, endsAt: serverNow + 30_000 } }, { now: serverNow });
    const { container } = render(<CrosswordPage sceneId="xw" token="good" />);
    await flush();
    const t = container.textContent ?? "";
    expect(t).toMatch(/0:(29|30)/);
    expect(t).not.toMatch(/5:(29|30)/);
  });

  it("reads 0:00 once the server time has passed, however the local clock reads", async () => {
    const serverNow = Date.now() - 300_000;
    routeState = pub({ seq: 3, spotlight: { entryId: "2D", startedAt: serverNow - 70_000, endsAt: serverNow - 10_000 } }, { now: serverNow });
    const { container } = render(<CrosswordPage sceneId="xw" token="good" />);
    await flush();
    expect(container.textContent ?? "").toMatch(/0:00/);
  });
});

describe("the finished-puzzle riser (pulseKey)", () => {
  it("fires when a puzzle finishes while the page is up", async () => {
    render(<CrosswordPage sceneId="xw" token="good" />);
    await flush();
    const base = risers();
    act(() => mockSocket.emit(CROSSWORD_STATE, envelope(CROSSWORD_STATE, finalePub({ seq: 4 }))));
    await flush();
    expect(risers()).toBe(base + 1);
  });

  it("fires once per finished puzzle, not again on later changes in the same finale", async () => {
    render(<CrosswordPage sceneId="xw" token="good" />);
    await flush();
    const base = risers();
    act(() => mockSocket.emit(CROSSWORD_STATE, envelope(CROSSWORD_STATE, finalePub({ seq: 4 }))));
    act(() => mockSocket.emit(CROSSWORD_STATE, envelope(CROSSWORD_STATE, finalePub({ seq: 5 }))));
    await flush();
    expect(risers()).toBe(base + 1);
    // The next puzzle's intro, then its finale: one more.
    act(() => mockSocket.emit(CROSSWORD_STATE, envelope(CROSSWORD_STATE, pub({ seq: 6, puzzleNo: 43, phase: "intro", spotlight: null }))));
    act(() => mockSocket.emit(CROSSWORD_STATE, envelope(CROSSWORD_STATE, finalePub({ seq: 7, puzzleNo: 43 }))));
    await flush();
    expect(risers()).toBe(base + 2);
  });

  it("does not fire when the page loads mid-finale", async () => {
    routeState = finalePub({ seq: 9 });
    const base = risers();
    render(<CrosswordPage sceneId="xw" token="good" />);
    await flush();
    expect(risers()).toBe(base);
    // A resync into the same finale is not a new finish either.
    await act(async () => {
      mockSocket.emit("connect");
    });
    await flush();
    expect(risers()).toBe(base);
  });
});
