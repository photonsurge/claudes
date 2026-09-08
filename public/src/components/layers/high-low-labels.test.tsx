/** lib/high-low-client is jest-mapped to a null stub, so the scan runs deferred
 *  on the test thread — the same promise shape the worker path has. */
import { renderHook, waitFor } from "@testing-library/react";
import { highLowLabelsFor, highLowLabelsReady, useHighLowLabels, type HighLowSpec } from "./high-low-labels";
import type { LoadedTexture } from "../../lib/textures";

const W = 360;
const H = 181;
const UNSCALE: [number, number] = [950, 1050];

/** A 1° global "pressure" texture: 1013 hPa with one high and one low. */
function texture(): LoadedTexture {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    for (let x = 0; x < W; x++) {
      const lng = -180 + ((x + 0.5) / W) * 360;
      const v =
        1013 + 20 * Math.exp(-((lng - 0) ** 2 + (lat - 30) ** 2) / 128) - 25 * Math.exp(-((lng - 120) ** 2 + (lat + 20) ** 2) / 128);
      const o = (y * W + x) * 4;
      data[o] = Math.round(((v - UNSCALE[0]) / (UNSCALE[1] - UNSCALE[0])) * 255);
      data[o + 3] = 255;
    }
  }
  return { data, width: W, height: H } as unknown as LoadedTexture;
}

const spec = (): HighLowSpec => ({ imageUnscale: UNSCALE, bounds: [-180, -90, 180, 90], radius: 2_000_000 });
type Props = { t: LoadedTexture | undefined; p: HighLowSpec | null };

describe("high/low labels (async, memoised per texture)", () => {
  it("scans once per texture and then answers synchronously", async () => {
    const tex = texture();
    expect(highLowLabelsReady(tex, spec())).toBeNull();
    const p1 = highLowLabelsFor(tex, spec());
    const p2 = highLowLabelsFor(tex, spec()); // joins the in-flight scan
    expect(p2).toBe(p1);
    const labels = await p1;
    expect(labels.map((l) => l.text).sort()).toEqual(["H", "L"]);
    const high = labels.find((l) => l.text === "H")!;
    expect(high.detail).toBe("1033");
    expect(high.align).toBe("center");
    expect(high.detailStyle).toBe("plain");
    // Known now: same array back, no second scan.
    expect(highLowLabelsReady(tex, spec())).toBe(labels);
    await expect(highLowLabelsFor(tex, spec())).resolves.toBe(labels);
  });

  it("useHighLowLabels: empty while scanning, then the memoised labels, stable across renders", async () => {
    const tex = texture();
    const init: Props = { t: tex, p: spec() };
    const { result, rerender } = renderHook(({ t, p }: Props) => useHighLowLabels(t, p), { initialProps: init });
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current.length).toBe(2));
    const first = result.current;
    rerender({ t: tex, p: spec() }); // a rebuilt spec object with the same content
    expect(result.current).toBe(first);
    // Pressure toggled off → nothing, and back on → instant.
    rerender({ t: tex, p: null });
    expect(result.current).toEqual([]);
    rerender({ t: tex, p: spec() });
    expect(result.current).toBe(first);
  });
});
