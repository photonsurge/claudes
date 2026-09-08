/**
 * Texture decode worker: fetch a baked PNG and hand back its RGBA bytes as
 * WeatherLayers TextureData ({ data, width, height }), off the main thread.
 *
 * WeatherLayers' own `loadTextureData` does the same via an <img> and a 2D
 * canvas `getImageData` on the main thread — ~10 ms per global GFS frame, and
 * the map-type tour decodes a handful of nests per cut, which showed up as
 * `getImageData` self time in the /watch profile. Here the whole thing
 * (network, decode, readback) runs in the worker and the buffer is transferred
 * back, so the main thread only ever sees a finished array.
 *
 * Same decode pipeline as an <img> drawn to a canvas (Blink's image decoder,
 * colour-managed to sRGB, alpha premultiplied for the canvas and un-multiplied
 * on readback), so bytes match what WeatherLayers would have produced. The
 * bakes use alpha 255 (data) or 0 (no data), so the premultiply round trip is
 * lossless for them.
 */
export type TextureDecodeRequest = { id: number; url: string };
export type TextureDecodeResponse =
  | { id: number; data: ArrayBuffer; width: number; height: number }
  | { id: number; error: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<TextureDecodeRequest>) => void) | null;
  postMessage(msg: TextureDecodeResponse, transfer?: Transferable[]): void;
};

async function decode(url: string): Promise<{ data: ArrayBuffer; width: number; height: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) throw new Error("no 2d context in worker");
    g.drawImage(bmp, 0, 0);
    const img = g.getImageData(0, 0, bmp.width, bmp.height);
    return { data: img.data.buffer, width: img.width, height: img.height };
  } finally {
    bmp.close();
  }
}

ctx.onmessage = (e) => {
  const { id, url } = e.data;
  decode(url).then(
    (r) => ctx.postMessage({ id, ...r }, [r.data]),
    (err: unknown) => ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) }),
  );
};
