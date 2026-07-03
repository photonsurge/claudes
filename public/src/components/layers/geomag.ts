"use client";

/**
 * Geomagnetic-field overlay — the whole-globe total-field intensity (IGRF), the
 * global magnetic MAP (distinct from the polar aurora). A full-globe SCALAR raster
 * rendered through WeatherLayers' RasterLayer with the `geomag` palette (deep blue
 * at the weak geomagnetic equator → red at the strong poles). Full-globe surface,
 * so DEPTH_OCCLUDE like the weather rasters — it both tests and seals depth.
 */
import { RasterLayer } from "weatherlayers-gl";
import type { TextureData } from "weatherlayers-gl";
import { getPalette } from "@photonsurge/shared/palettes";
import {
  GEOMAG_DOMAIN,
  GEOMAG_IMAGE_UNSCALE,
  type GeomagMeta,
} from "@photonsurge/shared/geomag/types";
import { scalePaletteToDomain } from "./props";
import { DEPTH_OCCLUDE } from "./depth";

export function geomagLayers(meta: GeomagMeta, texture: TextureData, opacity = 0.8) {
  return [
    new RasterLayer({
      id: "geomag-field",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      image: texture as any,
      imageUnscale: GEOMAG_IMAGE_UNSCALE,
      bounds: meta.bounds,
      palette: scalePaletteToDomain(getPalette("geomag"), GEOMAG_DOMAIN),
      domain: GEOMAG_DOMAIN,
      opacity,
      visible: true,
      parameters: DEPTH_OCCLUDE,
    }),
  ];
}
