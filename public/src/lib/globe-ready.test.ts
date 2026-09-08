import { act, renderHook, waitFor } from "@testing-library/react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { READY_TIMEOUT_MS, useGlobeReadyOnce } from "./globe-ready";
import { clearTextureCache } from "./textures";

const manifest = (files: Record<string, Record<string, string>>): WeatherManifest => ({
  model: "test",
  run: "2026-01-01T00:00:00Z",
  bounds: [-180, -90, 180, 90],
  grid: { width: 1, height: 1, res: 1 },
  steps: [],
  variables: Object.fromEntries(
    Object.entries(files).map(([id, f]) => [id, { encoding: "scalar", units: "", files: f }]),
  ),
});

beforeEach(() => clearTextureCache());

describe("useGlobeReadyOnce", () => {
  it("is false until every variable's texture at the current fhr has decoded, then latches true", async () => {
    const m = manifest({ temp: { "0": "/a.png" }, wind: { "0": "/b.png" } });
    const { result } = renderHook(({ manifest, fhr }) => useGlobeReadyOnce(manifest, fhr), {
      initialProps: { manifest: m, fhr: 0 },
    });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("stays false while there is no manifest yet", () => {
    const { result } = renderHook(({ manifest, fhr }) => useGlobeReadyOnce(manifest, fhr), {
      initialProps: { manifest: null as WeatherManifest | null, fhr: 0 },
    });
    expect(result.current).toBe(false);
  });

  it("latches when a set finishes even though fhr moved on before it did", async () => {
    // The 2026-09-08 outage: every re-run of the effect used to cancel the
    // previous load's latch, so inputs changing faster than a set loads left
    // the stream behind the cover indefinitely.
    const textures = jest.requireActual<typeof import("./textures")>("./textures");
    const pending = new Map<string, () => void>();
    const spy = jest.spyOn(textures, "loadTexture").mockImplementation(
      (url) =>
        new Promise((resolve) => {
          pending.set(url, () => resolve({ data: new Uint8Array(4), width: 1, height: 1 }));
        }),
    );
    try {
      const m = manifest({ temp: { "0": "/t0.png", "6": "/t6.png" } });
      const { result, rerender } = renderHook(({ manifest, fhr }) => useGlobeReadyOnce(manifest, fhr), {
        initialProps: { manifest: m, fhr: 0 },
      });
      expect(result.current).toBe(false);
      // The forecast hour steps on before /t0.png has decoded …
      rerender({ manifest: m, fhr: 6 });
      // … a refetched manifest with the same files must not start anything new …
      rerender({ manifest: { ...m }, fhr: 6 });
      expect(spy).toHaveBeenCalledTimes(2);
      // … and the FIRST set finishing is enough.
      pending.get("/t0.png")!();
      await waitFor(() => expect(result.current).toBe(true));
    } finally {
      spy.mockRestore();
    }
  });

  it("latches after READY_TIMEOUT_MS even if a texture never arrives", async () => {
    const textures = jest.requireActual<typeof import("./textures")>("./textures");
    const spy = jest.spyOn(textures, "loadTexture").mockImplementation(() => new Promise(() => {}));
    jest.useFakeTimers();
    try {
      const m = manifest({ temp: { "0": "/hung.png" } });
      const { result } = renderHook(({ manifest, fhr }) => useGlobeReadyOnce(manifest, fhr), {
        initialProps: { manifest: m, fhr: 0 },
      });
      expect(result.current).toBe(false);
      act(() => {
        jest.advanceTimersByTime(READY_TIMEOUT_MS - 1);
      });
      expect(result.current).toBe(false);
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(result.current).toBe(true);
    } finally {
      jest.useRealTimers();
      spy.mockRestore();
    }
  });

  it("never re-arms once ready, even if a later fhr has no texture for a variable", async () => {
    const m = manifest({ temp: { "0": "/a.png" } });
    const { result, rerender } = renderHook(({ manifest, fhr }) => useGlobeReadyOnce(manifest, fhr), {
      initialProps: { manifest: m, fhr: 0 },
    });
    await waitFor(() => expect(result.current).toBe(true));

    // fhr 6 has no texture at all for "temp" — a naive re-check might never
    // resolve, but ready must not drop back to false mid-broadcast.
    rerender({ manifest: m, fhr: 6 });
    expect(result.current).toBe(true);
  });
});
