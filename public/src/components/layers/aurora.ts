"use client";

/**
 * Aurora oval overlay. Rendered through WeatherLayers' `RasterLayer` — the same
 * finely-tessellated path the weather/SST rasters use — from a SCALAR probability
 * texture the worker bakes (sub-floor cells masked transparent). A coarse
 * full-globe `BitmapLayer` chords the sphere and leaks the oval as diamond
 * artifacts near the limb; RasterLayer hugs the sphere so the far-side oval is
 * cleanly depth-occluded. The `aurora` palette colours it green→red by intensity.
 */
import { RasterLayer } from "weatherlayers-gl";
import type { TextureData } from "weatherlayers-gl";
import { getPalette } from "@photonsurge/shared/palettes";
import {
  AURORA_DOMAIN,
  AURORA_IMAGE_UNSCALE,
  type AuroraMeta,
} from "@photonsurge/shared/aurora/types";
import { scalePaletteToDomain } from "./props";
import { DEPTH_TEST } from "./depth";

/**
 * The aurora oval as a WeatherLayers RasterLayer. DEPTH_TEST (not DEPTH_OCCLUDE):
 * it's a translucent overlay above the weather, so its far-side hemisphere is
 * occluded by the globe's depth sphere but it doesn't reseal depth — cities,
 * tracks and labels above it still draw on top.
 */
export function auroraLayers(meta: AuroraMeta, texture: TextureData, opacity = 0.85) {
  return [
    new RasterLayer({
      id: "aurora-oval",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      image: texture as any,
      imageUnscale: AURORA_IMAGE_UNSCALE,
      bounds: meta.bounds,
      // WeatherLayers maps the palette against the DECODED probability, so the
      // stops must be in physical % — scale the 0..1 ramp onto the aurora domain.
      palette: scalePaletteToDomain(getPalette("aurora"), AURORA_DOMAIN),
      domain: AURORA_DOMAIN,
      opacity,
      visible: true,
      parameters: DEPTH_TEST,
    }),
  ];
}
