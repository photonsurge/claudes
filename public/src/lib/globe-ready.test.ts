import { renderHook, waitFor } from "@testing-library/react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { useGlobeReadyOnce } from "./globe-ready";
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
