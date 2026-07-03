"use client";

/**
 * Aurora oval overlay. Rendered through WeatherLayers' `RasterLayer` from a
 * SCALAR probability texture the worker bakes (sub-floor cells masked
 * transparent). The `aurora` palette colours it green→red by intensity.
 *
 * DEPTH_PAINT + explicit back-face cull (mirrors satimg.ts and the basemap's
 * draped land fill): the aurora surface sits almost exactly at the same radius
 * as the basemap sphere beneath it, so depth-TEST-based parameters (DEPTH_TEST,
 * DEPTH_OCCLUDE) z-fight against that near-coincident depth — visible as a
 * lattice of diamond artifacts that gets worse the further out you zoom (depth
 * precision loss) and clears up zoomed in. DEPTH_PAINT sidesteps the z-buffer
 * entirely and paints in draw order (aurora is pushed after the basemap/weather
 * layers in Globe.tsx, so it draws on top); `cullMode: "back"` drops the far
 * hemisphere's triangles geometrically instead of numerically.
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
import { DEPTH_PAINT } from "./depth";

const AURORA_PARAMS = { ...DEPTH_PAINT, cullMode: "back" };

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
      parameters: AURORA_PARAMS,
    }),
  ];
}
