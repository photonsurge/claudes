/**
 * The broadcast quake hook's latch (round 54): once the director has shown
 * quakes, turning them off must NOT clear the list. The globe keeps the quake
 * layers mounted and merely hidden across the off-cuts, and an empty list
 * would unmount them — putting the four-layer init (and, the first time, the
 * label atlas) back inside the next on-cut.
 */
import { renderHook, waitFor } from "@testing-library/react";

jest.mock("./socket-provider", () => ({ useSocket: () => ({ socket: null }) }));
jest.mock("./focus/focus-client", () => ({ useFocusTarget: () => null, useFocusAreaQuakes: () => [] }));
const listQuakes = jest.fn(async () => ({ quakes: [{ id: "q1", mag: 5.2, lat: 1, lng: 2, depthKm: 10, time: 0, place: "x" }] }));
jest.mock("./tracks/client", () => ({ listQuakes: (...a: unknown[]) => listQuakes(...a) }));

import { useBroadcastQuakes } from "./seismic-overlay";

describe("useBroadcastQuakes", () => {
  it("never fetches while it has not been shown", async () => {
    const { result } = renderHook(() => useBroadcastQuakes(false, 2.5));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toEqual([]);
    expect(listQuakes).not.toHaveBeenCalled();
  });

  it("keeps its list across the cuts that turn quakes off", async () => {
    const { result, rerender } = renderHook(({ on }) => useBroadcastQuakes(on, 2.5), { initialProps: { on: true } });
    await waitFor(() => expect(result.current).toHaveLength(1));
    const shown = result.current;
    rerender({ on: false });
    expect(result.current).toBe(shown); // still mounted on the globe, just hidden
    rerender({ on: true });
    await waitFor(() => expect(result.current).toHaveLength(1));
  });
});
