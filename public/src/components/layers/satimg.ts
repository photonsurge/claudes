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
import type { SatImgMeta, SatImgFeedState } from "@photonsurge/shared/satimg/types";
import { DEPTH_PAINT } from "./depth";

/**
 * DEPTH_PAINT + explicit back-face cull. DEPTH_PAINT (no depth test) stops the coarse
 * BitmapLayer quads diamond-culling against the globe's depth sphere; but with the
 * test off, a FULL-GLOBE frame's far hemisphere paints straight through the front
 * (dense z-fight striping — the "global looks screwed" bug). `cullMode: "back"` drops
 * the far-facing triangles so only the near hemisphere draws. Regional discs (one
 * hemisphere, no far side) are unaffected. If a globe ever renders BLANK where a feed
 * should be, the mesh winding is reversed — flip this to "front".
 */
const SATIMG_PARAMS = { ...DEPTH_PAINT, cullMode: "back" };

/**
 * One BitmapLayer per baked feed the operator has ticked ON, at that feed's own
 * opacity, over its own coverage bounds (global mosaic + live regional discs, each
 * transparent outside its data). `feeds` is the per-feed control state keyed by
 * satId; frames whose feed is off (or unknown) are skipped.
 *
 * DEPTH_PAINT (not DEPTH_TEST): a BitmapLayer's coarse globe mesh bows each quad
 * INSIDE the sphere, so depth-testing against the globe culls every quad's centre
 * and leaves its corners — the "diamond artifacts" the aurora layer warns about
 * (aurora dodges it by using WeatherLayers' finely-tessellated RasterLayer, which
 * only colourmaps scalar data and can't render this RGBA imagery). DEPTH_PAINT
 * skips the depth test so each quad paints whole; the far hemisphere is culled by
 * GlobeView's `cullMode: 'back'` — the same trick the draped land fill uses.
 */
export function satimgLayers(
  frames: SatImgMeta[],
  feeds: Record<string, SatImgFeedState>,
): BitmapLayer[] {
  return frames
    .filter((f) => feeds[f.satId]?.on)
    .map(
      (f) =>
        new BitmapLayer({
          id: `satimg-${f.satId}`,
          image: `/api/satimg/frame.png?sat=${encodeURIComponent(f.satId)}&v=${encodeURIComponent(f.updatedAt)}`,
          bounds: f.bounds,
          opacity: feeds[f.satId]?.opacity ?? 1,
          parameters: SATIMG_PARAMS,
        }),
    );
}
