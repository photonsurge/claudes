/**
 * useAlertFeatures — the globe's warning shapes.
 *
 * The behaviours worth pinning are the on-air ones: the overlay must not blank
 * out when a poll fails, must not refetch every time the director toggles
 * showAlerts, and must filter from warm data rather than going back to the
 * network (which would also fragment the shared Redis entry).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAlertFeatures } from "./alerts-overlay";
import { ALERTS_UPDATED } from "@photonsurge/shared/control";

/** Fire the worker's "alerts changed" beat, keyed on the real event NAME — using
 *  the literal "ALERTS_UPDATED" silently never fires, which makes the
 *  keeps-last-good tests below pass for the wrong reason. */
const alertsUpdated = () => handlers[ALERTS_UPDATED]?.();

const handlers: Record<string, (() => void) | undefined> = {};
jest.mock("./socket-provider", () => ({
  useSocket: () => ({
    socket: {
      on: (e: string, fn: () => void) => {
        handlers[e] = fn;
      },
      off: (e: string) => {
        delete handlers[e];
      },
    },
  }),
}));

const feature = (hazard: string, severityRank: number, id = `${hazard}-${severityRank}`) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [] },
  properties: { id, hazard, severityRank },
});

const FEATURES = [feature("heat", 4), feature("flood", 2), feature("wind", 1)];

function mockFetch(features: unknown[] = FEATURES) {
  const fn = jest.fn().mockResolvedValue({ json: async () => ({ features, count: features.length }) });
  (global as any).fetch = fn;
  return fn;
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (global as any).fetch;
  for (const k of Object.keys(handlers)) delete handlers[k];
});

describe("useAlertFeatures", () => {
  it("draws the dissolved shapes, not the raw alert feed", async () => {
    const fn = mockFetch();

    const { result } = renderHook(() => useAlertFeatures(true, 0));

    await waitFor(() => expect(result.current).toHaveLength(3));
    expect(fn).toHaveBeenCalledWith("/api/alerts/blobs", expect.anything());
  });

  it("fetches nothing until something wants alerts", () => {
    const fn = mockFetch();

    renderHook(() => useAlertFeatures(false, 0));

    expect(fn).not.toHaveBeenCalled();
  });

  it("stays armed when the director toggles showAlerts off", async () => {
    // The auto-director flips showAlerts on every cut. Re-fetching + re-tessellating
    // per shot is exactly what the latch exists to prevent.
    const fn = mockFetch();
    const { result, rerender } = renderHook(({ on }) => useAlertFeatures(on, 0), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current).toHaveLength(3));

    rerender({ on: false });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current).toHaveLength(3); // data stays warm
  });

  it("keeps the last good shapes when a poll fails", async () => {
    // A transient failure must never blank an on-air overlay.
    const fn = mockFetch();
    const { result } = renderHook(() => useAlertFeatures(true, 0));
    await waitFor(() => expect(result.current).toHaveLength(3));

    fn.mockRejectedValueOnce(new Error("network"));
    await act(async () => alertsUpdated());

    await waitFor(() => expect(result.current).toHaveLength(3));
  });

  it("keeps the last good shapes when a poll returns empty", async () => {
    const fn = mockFetch();
    const { result } = renderHook(() => useAlertFeatures(true, 0));
    await waitFor(() => expect(result.current).toHaveLength(3));

    fn.mockResolvedValueOnce({ json: async () => ({ features: [] }) });
    await act(async () => alertsUpdated());

    await waitFor(() => expect(result.current).toHaveLength(3));
  });

  it("redraws when the worker says alerts changed", async () => {
    const fn = mockFetch();
    const { result } = renderHook(() => useAlertFeatures(true, 0));
    await waitFor(() => expect(result.current).toHaveLength(3));

    fn.mockResolvedValueOnce({ json: async () => ({ features: [feature("fire", 3)] }) });
    await act(async () => alertsUpdated());

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].properties.hazard).toBe("fire");
  });

  it("filters the severity floor from warm data, without refetching", async () => {
    // Client-side on purpose: a query param would fragment the shared Redis entry
    // per filter combination and make every toggle a fresh compose.
    const fn = mockFetch();
    const { result, rerender } = renderHook(({ min }) => useAlertFeatures(true, min), {
      initialProps: { min: 0 },
    });
    await waitFor(() => expect(result.current).toHaveLength(3));

    rerender({ min: 3 });

    expect(result.current.map((f) => f.properties.hazard)).toEqual(["heat"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("filters hazard chips from warm data too", async () => {
    const fn = mockFetch();
    const { result, rerender } = renderHook(({ off }) => useAlertFeatures(true, 0, off), {
      initialProps: { off: [] as string[] },
    });
    await waitFor(() => expect(result.current).toHaveLength(3));

    rerender({ off: ["heat", "wind"] });

    expect(result.current.map((f) => f.properties.hazard)).toEqual(["flood"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("survives a malformed response rather than throwing at the globe", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ json: async () => ({}) });

    const { result } = renderHook(() => useAlertFeatures(true, 0));

    await waitFor(() => expect(result.current).toEqual([]));
  });
});
