"use client";

/**
 * Aurora oval overlay — the worker bakes NOAA SWPC's OVATION probability grid into
 * a single pre-coloured translucent glow PNG (green→red, alpha ∝ activity) and the
 * client just wraps that served image in a BitmapLayer, exactly like the base-map
 * `globalImageLayer`. No runtime canvas atlas (which renders blank under the
 * _GlobeView build) — a real served .png draped over the whole sphere.
 */
import { BitmapLayer } from "@deck.gl/layers";
import type { AuroraMeta } from "@photonsurge/shared/aurora/types";
import { DEPTH_TEST } from "./depth";

/**
 * The aurora glow drawn over the poles. `meta.updatedAt` is folded into the image
 * URL so deck.gl reloads the texture the instant the worker bakes a new frame
 * (the URL string changes → BitmapLayer refetches). DEPTH_TEST so the far-side
 * oval is occluded by the globe but the layer doesn't reseal the depth sphere.
 */
export function auroraLayers(meta: AuroraMeta, opacity = 0.9) {
  const image = `/api/aurora/image?v=${encodeURIComponent(meta.updatedAt)}`;
  return [
    new BitmapLayer({
      id: "aurora-oval",
      image,
      bounds: meta.bounds,
      opacity,
      parameters: DEPTH_TEST,
    }),
  ];
}
