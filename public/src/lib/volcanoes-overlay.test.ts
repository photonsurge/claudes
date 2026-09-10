/**
 * The volcano feed's identity discipline (round 47): an unchanged body must
 * come back as the SAME array, so the five worker beats a bulletin cycle emits
 * don't each re-render every consumer of `volcanoes` for nothing.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

type Handler = (p?: { kind?: string }) => void;
const handlers: Handler[] = [];
jest.mock("./socket-provider", () => ({
  useSocket: () => ({
    socket: {
      on: (_ev: string, h: Handler) => handlers.push(h),
      off: (_ev: string, h: Handler) => handlers.splice(handlers.indexOf(h), 1),
    },
  }),
}));

import { listVolcanoes, resetVolcanoFeedCache, useVolcanoes } from "./volcanoes-overlay";

const body = (...names: string[]) =>
  JSON.stringify({ count: names.length, volcanoes: names.map((name, i) => ({ id: `v${i}`, name, lat: 0, lng: i, status: "erupting" })) });

function mockFetch(bodies: string[], ok = true) {
  let n = 0;
  const fn = jest.fn(async () => {
    const text = bodies[Math.min(n++, bodies.length - 1)];
    return { ok, text: async () => text, json: async () => JSON.parse(text) };
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}

beforeEach(() => {
  resetVolcanoFeedCache();
  handlers.length = 0;
});

describe("listVolcanoes", () => {
  it("an unchanged body returns the same array; a changed one a new array", async () => {
    mockFetch([body("Etna", "Kīlauea"), body("Etna", "Kīlauea"), body("Etna", "Kīlauea", "Semeru")]);
    const a = await listVolcanoes();
    const b = await listVolcanoes();
    const c = await listVolcanoes();
    expect(a.map((v) => v.name)).toEqual(["Etna", "Kīlauea"]);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(c).toHaveLength(3);
  });

  it("a failed read or a broken body keeps the previous list on air", async () => {
    mockFetch([body("Etna")]);
    const a = await listVolcanoes();
    mockFetch(["<html>502</html>"], false);
    expect(await listVolcanoes()).toBe(a);
    mockFetch(["{not json"]);
    expect(await listVolcanoes()).toBe(a);
    resetVolcanoFeedCache();
    mockFetch(["oops"], false);
    expect(await listVolcanoes()).toEqual([]); // nothing remembered yet: empty, not a throw
  });
});

describe("useVolcanoes", () => {
  it("a TRACKS_UPDATED beat with the same body does not hand consumers a new array", async () => {
    const fn = mockFetch([body("Etna"), body("Etna"), body("Etna", "Semeru")]);
    const { result } = renderHook(() => useVolcanoes(true));
    await waitFor(() => expect(result.current).toHaveLength(1));
    const first = result.current;
    await act(async () => {
      for (const h of handlers) h({ kind: "volcanoes" });
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(first); // same identity — React bailed out
    await act(async () => {
      for (const h of handlers) h({ kind: "volcanoes" });
    });
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current).not.toBe(first);
  });

  it("disabled ⇒ empty, and no fetch", async () => {
    const fn = mockFetch([body("Etna")]);
    const { result } = renderHook(() => useVolcanoes(false));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
