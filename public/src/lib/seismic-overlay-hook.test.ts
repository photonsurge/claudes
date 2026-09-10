/**
 * The broadcast quake hook feeds the globe from page load whatever the
 * director's toggle says (rounds 54–55): the quake layers stay mounted and
 * merely hidden across the off-cuts, so their one-time init (two shader links
 * and the label atlas) happens at load, and an emptied list would unmount
 * them and put that init back inside the next on-cut.
 */
import { renderHook, waitFor } from "@testing-library/react";

jest.mock("./socket-provider", () => ({ useSocket: () => ({ socket: null }) }));
jest.mock("./focus/focus-client", () => ({ useFocusTarget: () => null, useFocusAreaQuakes: () => [] }));
const listQuakes = jest.fn(async () => ({ quakes: [{ id: "q1", mag: 5.2, lat: 1, lng: 2, depthKm: 10, time: 0, place: "x" }] }));
jest.mock("./tracks/client", () => ({ listQuakes: () => listQuakes() }));

import { useBroadcastQuakes } from "./seismic-overlay";

describe("useBroadcastQuakes", () => {
  it("fetches from mount even while quakes are off air", async () => {
    const { result } = renderHook(() => useBroadcastQuakes(false, 2.5));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(listQuakes).toHaveBeenCalledTimes(1);
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
