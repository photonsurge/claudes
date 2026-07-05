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
import { SATIMG_FEEDS, type SatImgMeta, type SatImgFeedState } from "@photonsurge/shared/satimg/types";
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
 * One BitmapLayer per FEED the operator has ticked ON, drawn over its coverage bounds at
 * its own opacity (each frame is transparent outside its data). `feeds` is the per-feed
 * state (keyed by feed id) — for a DISC it also carries that disc's own composite `look`.
 *
 * Frame resolution by feed kind:
 *  - `mosaic` / `overlay` (global, lightning): the frame whose satId === the feed id.
 *  - `disc`: the frame `${id}:${feedLook}`, falling back to `${id}:ir` when that disc
 *    doesn't carry its chosen look (every disc bakes an IR frame). Changing a disc's look
 *    re-points the same layer id at a new satId → new cache-busted URL, updating in place.
 *
 * DEPTH_PAINT (not DEPTH_TEST): a BitmapLayer's coarse globe mesh bows each quad INSIDE
 * the sphere, so depth-testing against the globe culls every quad's centre and leaves its
 * corners — the "diamond artifacts". DEPTH_PAINT skips the test so each quad paints whole;
 * the far hemisphere is culled by GlobeView's built-in `cullMode: 'back'`.
 */
export function satimgLayers(
  frames: SatImgMeta[],
  feeds: Record<string, SatImgFeedState>,
): BitmapLayer[] {
  const byId = new Map(frames.map((f) => [f.satId, f]));
  const layers: BitmapLayer[] = [];
  for (const feed of SATIMG_FEEDS) {
    const fs = feeds[feed.id];
    if (!fs?.on) continue;
    const frame =
      feed.kind === "disc"
        ? byId.get(`${feed.id}:${fs.look ?? "geocolor"}`) ?? byId.get(`${feed.id}:ir`)
        : byId.get(feed.id);
    if (!frame) continue;
    layers.push(
      new BitmapLayer({
        id: `satimg-${feed.id}`,
        image: `/api/satimg/frame.png?sat=${encodeURIComponent(frame.satId)}&v=${encodeURIComponent(frame.updatedAt)}`,
        bounds: frame.bounds,
        opacity: fs.opacity ?? 1,
        parameters: SATIMG_PARAMS,
      }),
    );
  }
  return layers;
}
