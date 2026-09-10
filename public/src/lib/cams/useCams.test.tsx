/**
 * useCams — the broadcast's webcam read is scoped to the on-air centre.
 *
 * Pinned: one `/api/cams?lng&lat&maxKm` read per place, none without a centre
 * or while disabled, and NO refetch for a new tuple with the same coordinates
 * (the camera object is re-created on every socket beat). The full-catalog
 * read this replaced was a 68 MB JSON per page load (round 46).
 */
import { renderHook, waitFor } from "@testing-library/react";

jest.mock("../socket-provider", () => ({ useSocket: () => ({ socket: null }) }));

import { useCams, camsFocusKey, CAMS_NEAR_KM } from "./useCams";

const cam = (camId: string) => ({ camId, provider: "windy", title: camId, lat: 51.5, lng: -0.1, status: "active" });

function mockFetch(camsByCall: unknown[][] = [[cam("a"), cam("b")]]) {
  let n = 0;
  const fn = jest.fn(async () => {
    const cams = camsByCall[Math.min(n++, camsByCall.length - 1)];
    return { ok: true, json: async () => ({ cams, count: cams.length }) };
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}
const urlOf = (fn: jest.Mock, i = 0) => String(fn.mock.calls[i][0]);

describe("useCams", () => {
  it("reads the cams near the centre, with the panel's radius", async () => {
    const fn = mockFetch();
    const { result } = renderHook(() => useCams(true, [-0.1234567, 51.5]));
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(fn).toHaveBeenCalledTimes(1);
    const u = new URL(urlOf(fn), "http://x");
    expect(u.pathname).toBe("/api/cams");
    expect(u.searchParams.get("lng")).toBe("-0.123");
    expect(u.searchParams.get("lat")).toBe("51.500");
    expect(u.searchParams.get("maxKm")).toBe(String(CAMS_NEAR_KM));
  });

  it("does not fetch without a centre, or while disabled", async () => {
    const fn = mockFetch();
    const { result: off } = renderHook(() => useCams(false, [0, 0]));
    const { result: none } = renderHook(() => useCams(true, null));
    await new Promise((r) => setTimeout(r, 0));
    expect(fn).not.toHaveBeenCalled();
    expect(off.current).toEqual([]);
    expect(none.current).toEqual([]);
  });

  it("a fresh tuple with the same coordinates is not a new place; a real move is", async () => {
    const fn = mockFetch([[cam("a")], [cam("z")]]);
    const { result, rerender } = renderHook(({ c }: { c: [number, number] }) => useCams(true, c), {
      initialProps: { c: [-0.1, 51.5] as [number, number] },
    });
    await waitFor(() => expect(result.current.map((c) => c.camId)).toEqual(["a"]));
    rerender({ c: [-0.1, 51.5] }); // identity churn only
    await new Promise((r) => setTimeout(r, 0));
    expect(fn).toHaveBeenCalledTimes(1);
    rerender({ c: [139.7, 35.7] }); // Tokyo
    expect(result.current).toEqual([]); // the old place's cams go at once
    await waitFor(() => expect(result.current.map((c) => c.camId)).toEqual(["z"]));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("camsFocusKey: ~100 m buckets, empty for no/invalid centre", () => {
    expect(camsFocusKey([-0.12345, 51.50001])).toBe("-0.123,51.500");
    expect(camsFocusKey([-0.1234, 51.5004])).toBe(camsFocusKey([-0.1231, 51.4996]));
    expect(camsFocusKey(null)).toBe("");
    expect(camsFocusKey([Number.NaN, 1])).toBe("");
  });
});
