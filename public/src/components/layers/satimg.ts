"use client";

/**
 * Geostationary satellite-imagery overlay. Each baked bird (Himawari-9 …) is a
 * reprojected full-globe RGBA PNG (transparent outside its Earth disk), drawn as a
 * deck.gl `BitmapLayer` — the SAME layer + full-globe bounds the base-map satellite
 * image uses, so the geometry is proven and no partial-bounds quad chords the limb.
 * `image` is the PNG URL (deck loads it; the `&v=updatedAt` query busts the cache
 * when the worker re-bakes). DEPTH_TEST: it's an overlay above the weather, so its
 * far-side hemisphere is occluded by the globe's depth sphere but it doesn't reseal
 * depth — cities / tracks / labels above it still draw on top (mirrors aurora).
 */
import { BitmapLayer } from "@deck.gl/layers";
import type { SatImgMeta } from "@photonsurge/shared/satimg/types";
import { DEPTH_TEST } from "./depth";

export function satimgLayers(frames: SatImgMeta[], opacity = 1): BitmapLayer[] {
  return frames.map(
    (f) =>
      new BitmapLayer({
        id: `satimg-${f.satId}`,
        image: `/api/satimg/frame.png?sat=${encodeURIComponent(f.satId)}&v=${encodeURIComponent(f.updatedAt)}`,
        bounds: f.bounds,
        opacity,
        parameters: DEPTH_TEST,
      }),
  );
}
