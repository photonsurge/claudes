/**
 * The socket provider must survive days unattended in an OBS browser source:
 * a token mint that fails at cold start is retried, every connection attempt
 * carries a freshly minted (1h) token, and a handshake the server denied —
 * where socket.io stops reconnecting by itself — is re-opened after a backoff.
 */
import { render, act, screen } from "@testing-library/react";

type Handler = (...a: unknown[]) => void;
type FakeSocket = {
  url: string;
  opts: { auth: (cb: (d: object) => void) => void };
  active: boolean;
  handlers: Map<string, Handler>;
  on: (e: string, fn: Handler) => void;
  fire: (e: string, ...a: unknown[]) => void;
  connect: jest.Mock;
  disconnect: jest.Mock;
};
const sockets: FakeSocket[] = [];
jest.mock("socket.io-client", () => ({
  io: (url: string, opts: FakeSocket["opts"]) => {
    const handlers = new Map<string, Handler>();
    const s: FakeSocket = {
      url,
      opts,
      active: true,
      handlers,
      on: (e, fn) => handlers.set(e, fn),
      fire: (e, ...a) => handlers.get(e)?.(...a),
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    sockets.push(s);
    return s;
  },
}));

import { SocketProvider, useSocket } from "./socket-provider";

function Probe() {
  const { socket, connected } = useSocket();
  return <span data-testid="probe">{socket ? (connected ? "connected" : "open") : "none"}</span>;
}

/** Queue of token-mint outcomes: a string mints that token, null is a failure. */
let mints: (string | null)[] = [];
/** Let pending promises + 0-ms timers settle under fake timers. */
const flush = () => act(() => jest.advanceTimersByTimeAsync(0));

describe("SocketProvider", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sockets.length = 0;
    mints = [];
    global.fetch = jest.fn(async () => {
      const t = mints.shift();
      if (t === null) throw new Error("backend down");
      return { ok: true, status: 200, json: async () => ({ token: t ?? "tok", socketUrl: "ws://sock" }) };
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("retries a failed token mint until it lands, then connects with a per-attempt auth function", async () => {
    mints = [null, "t1", "t2"];
    render(
      <SocketProvider>
        <Probe />
      </SocketProvider>,
    );
    await flush();
    expect(sockets).toHaveLength(0);
    expect(screen.getByTestId("probe").textContent).toBe("none");

    await act(() => jest.advanceTimersByTimeAsync(2_000));
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe("ws://sock");
    expect(screen.getByTestId("probe").textContent).toBe("open");

    // Each attempt mints afresh — the second attempt sends t2, not the boot token.
    const got: object[] = [];
    await act(async () => sockets[0].opts.auth((d) => got.push(d)));
    await flush();
    expect(got).toEqual([{ token: "t2", actorType: "user" }]);

    // A failed mint falls back to the last good token rather than stalling.
    mints = [null];
    await act(async () => sockets[0].opts.auth((d) => got.push(d)));
    await flush();
    expect(got[1]).toEqual({ token: "t2", actorType: "user" });

    act(() => sockets[0].fire("connect"));
    expect(screen.getByTestId("probe").textContent).toBe("connected");
  });

  it("re-opens the socket after a denied handshake or a server-side disconnect", async () => {
    mints = ["t1"];
    render(
      <SocketProvider>
        <Probe />
      </SocketProvider>,
    );
    await flush();
    const s = sockets[0];

    // socket.io keeps retrying by itself while `active`: nothing to do.
    act(() => s.fire("connect_error", new Error("timeout")));
    await act(() => jest.advanceTimersByTimeAsync(5_000));
    expect(s.connect).not.toHaveBeenCalled();

    // Denied by the handshake middleware (e.g. "Token expired"): socket.io gives
    // up, we re-open after the backoff.
    s.active = false;
    act(() => s.fire("connect_error", new Error("Token expired")));
    await act(() => jest.advanceTimersByTimeAsync(1_999));
    expect(s.connect).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTimeAsync(1));
    expect(s.connect).toHaveBeenCalledTimes(1);

    // Still denied: the next wait doubles.
    act(() => s.fire("connect_error", new Error("Token expired")));
    await act(() => jest.advanceTimersByTimeAsync(3_999));
    expect(s.connect).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTimeAsync(1));
    expect(s.connect).toHaveBeenCalledTimes(2);

    // A connect resets the backoff; a server-side disconnect re-opens too.
    s.active = true;
    act(() => s.fire("connect"));
    s.active = false;
    act(() => s.fire("disconnect", "io server disconnect"));
    await act(() => jest.advanceTimersByTimeAsync(2_000));
    expect(s.connect).toHaveBeenCalledTimes(3);
  });
});
