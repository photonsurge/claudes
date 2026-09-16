/**
 * Cold start + re-sync: the loader is retried until it lands, run again on
 * every socket (re)connect, and cancelled on unmount so nothing lands late.
 */
import { renderHook, act } from "@testing-library/react";
import { useLoadAndResync } from "./use-resync";

/** A socket whose "connect" handler the test can fire by hand. */
function fakeSocket() {
  const handlers = new Map<string, () => void>();
  return {
    on: (e: string, fn: () => void) => handlers.set(e, fn),
    off: (e: string) => handlers.delete(e),
    fire: (e: string) => handlers.get(e)?.(),
    has: (e: string) => handlers.has(e),
  };
}

/** Let pending promises + 0-ms timers settle under fake timers. */
const flush = () => act(() => jest.advanceTimersByTimeAsync(0));

describe("useLoadAndResync", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("retries a failed cold start until it lands", async () => {
    let calls = 0;
    const load = jest.fn(async () => (++calls < 3 ? null : { v: calls }));
    const onValue = jest.fn();
    renderHook(() => useLoadAndResync(null, load, onValue, []));
    await flush();
    expect(onValue).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTimeAsync(2_000)); // attempt 2 (still null)
    await act(() => jest.advanceTimersByTimeAsync(4_000)); // attempt 3 lands
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue).toHaveBeenCalledWith({ v: 3 });
  });

  it("re-fetches on every socket (re)connect, with the latest loader", async () => {
    const socket = fakeSocket();
    const onValue = jest.fn();
    const { rerender } = renderHook(
      ({ id }) => useLoadAndResync(socket, async () => ({ id }), onValue, [id]),
      { initialProps: { id: "a" } },
    );
    await flush();
    expect(onValue).toHaveBeenLastCalledWith({ id: "a" });
    expect(socket.has("connect")).toBe(true);

    act(() => socket.fire("connect"));
    await flush();
    expect(onValue).toHaveBeenCalledTimes(2);

    rerender({ id: "b" });
    await flush();
    act(() => socket.fire("connect"));
    await flush();
    expect(onValue).toHaveBeenLastCalledWith({ id: "b" });
  });

  it("cancels the in-flight retry loop on unmount", async () => {
    const load = jest.fn(async () => null);
    const onValue = jest.fn();
    const socket = fakeSocket();
    const { unmount } = renderHook(() => useLoadAndResync(socket, load, onValue, []));
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    unmount();
    await act(() => jest.advanceTimersByTimeAsync(60_000));
    expect(load).toHaveBeenCalledTimes(1);
    expect(socket.has("connect")).toBe(false);
  });
});
