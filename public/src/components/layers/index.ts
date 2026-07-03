/**
 * Layer construction: turn the PURE props (props.ts) into deck.gl /
 * WeatherLayers layer instances. Kept thin so all logic stays testable in
 * props.ts and the GL-bound construction here is mocked in tests.
 */
"use client";

import { ScatterplotLayer } from "@deck.gl/layers";
import {
  RasterLayer,
  ParticleLayer,
  ContourLayer,
  HighLowLayer,
} from "weatherlayers-gl";
import type { WeatherManifest, WeatherVariableManifest } from "@photonsurge/shared/manifest";
import type { LoadedTexture } from "../../lib/textures";
import type { City } from "../../lib/cities";
import {
  windParticleProps,
  vectorParticleProps,
  vectorParticlePropsFromEntry,
  scalarRasterProps,
  scalarRasterPropsFromEntry,
  pressureProps,
  elevationProps,
  cityProps,
  manifestBounds,
  type Bounds,
} from "./props";
import { resolveEntries, rankNestsByFit, type ResolverCamera } from "./resolve";
import { DEPTH_OCCLUDE, DEPTH_TEST, DEPTH_PAINT } from "./depth";

/** A resolver mapping a texture URL to an already-loaded image (or undefined). */
export type TextureResolver = (url: string) => LoadedTexture | undefined;

/**
 * Vector ParticleLayer for any uv field (wind, ocean current). Decodes u/v via
 * the manifest's `vectorUnscale`; `opts.colorByMagnitude` colours by speed
 * (currents) instead of the flat colour (wind).
 */
export function vectorParticleLayer(
  manifest: WeatherManifest,
  variableId: string,
  fhr: number,
  resolve: TextureResolver,
  opts?: Parameters<typeof vectorParticleProps>[3],
): ParticleLayer | null {
  const props = vectorParticleProps(manifest, variableId, fhr, opts);
  if (!props) return null;
  const image = resolve(props.image);
  if (!image) return null;
  // WeatherLayers accepts an ImageBitmap/HTMLImageElement at runtime; its prop
  // type is narrower than that, so cast at the boundary.
  // Depth-tested so the far hemisphere is occluded by the depth sphere; this also
  // overrides WeatherLayers' own `depthCompare: "always"` (which would otherwise
  // bleed back-side particles through AND disable depth for later layers).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ParticleLayer({ ...props, image: image as any, parameters: DEPTH_TEST });
}

export function windParticleLayer(
  manifest: WeatherManifest,
  fhr: number,
  resolve: TextureResolver,
  opts?: Parameters<typeof windParticleProps>[2],
): ParticleLayer | null {
  return vectorParticleLayer(manifest, "wind", fhr, resolve, opts);
}

export function scalarRasterLayer(
  manifest: WeatherManifest,
  variableId: string,
  fhr: number,
  resolve: TextureResolver,
  opts?: Parameters<typeof scalarRasterProps>[3],
): RasterLayer | null {
  const props = scalarRasterProps(manifest, variableId, fhr, opts);
  if (!props) return null;
  const image = resolve(props.image);
  if (!image) return null;
  // The raster fills the whole globe, so it both tests AND writes depth: its far
  // hemisphere is occluded by the depth sphere, and its near hemisphere seals the
  // surface (overriding WeatherLayers' `depthCompare: "always"`) so nothing on the
  // far side bleeds through the front ("see-through globe").
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new RasterLayer({ ...props, image: image as any, parameters: DEPTH_OCCLUDE });
}

/**
 * Regional-nest aware scalar rasters: the global base plus every ACTIVE nest for
 * this variable at the current camera, finest last (drawn on top). Each nest is
 * the same RasterLayer clipped to its own `bbox`. A nest-only variable (radar,
 * empty base `files`) yields just its nests; a source with no nests yields the
 * single base layer — identical to `scalarRasterLayer`.
 */
export function scalarRasterLayers(
  manifest: WeatherManifest,
  variableId: string,
  fhr: number,
  resolve: TextureResolver,
  camera: ResolverCamera,
  opts?: { opacity?: number },
): RasterLayer[] {
  const entries = resolveEntries(manifest.variables[variableId], camera);
  const out: RasterLayer[] = [];
  // Nests render at the SAME opacity as the base (props default 0.7), NOT forced
  // opaque. Single-winner draws only ONE detail nest over the base, so the old
  // "opaque to avoid double-exposing the base" rule just made the high-res region
  // POP as a brighter box (a hard seam vs the semi-transparent base). Matching the
  // base opacity makes the nest read as the same surface with finer detail inside.
  const buildNest = (e: WeatherVariableManifest, i: number) =>
    e.bbox ? scalarRasterPropsFromEntry(e, variableId, fhr, e.bbox, { ...opts, idSuffix: `-${e.sourceId ?? `n${i}`}` }) : null;
  // Base (entries[0]) fills the globe and SEALS the depth sphere (DEPTH_OCCLUDE).
  const base = entries[0];
  const baseBounds = base ? manifestBounds(manifest) : undefined;
  let baseNestIndex = -1;
  if (base && baseBounds) {
    const props = scalarRasterPropsFromEntry(base, variableId, fhr, baseBounds, {
      ...opts,
      opacity: opts?.opacity,
      idSuffix: "",
    });
    const image = props && resolve(props.image);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (props && image) out.push(new RasterLayer({ ...props, image: image as any, parameters: DEPTH_OCCLUDE }));
    else {
      // No TRUE global base drew (nest-only variable, e.g. temp/humidity whose base
      // has empty `files`). Promote the COARSEST loaded nest — icon-global spans the
      // whole globe (minZoom 2) — to act as the base so the planet still gets colour
      // UNDER the fine regional nest, instead of going black outside the nest bbox.
      const coarse = pickCoarsestLoaded(entries, buildNest, resolve);
      if (coarse) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        out.push(new RasterLayer({ ...coarse.props, image: coarse.image as any, parameters: DEPTH_OCCLUDE }));
        baseNestIndex = coarse.index;
      }
    }
  }
  // Nests: over the base draw ONLY the finest available one, never a stack.
  // `resolveEntries` returns nests coarsest→finest, so we walk from the finest end
  // and take the first whose texture is loaded. Stacking every active nest painted
  // each one's rectangular bbox as a hard-edged seam (models disagree, so the edges
  // show); one clip-to-bbox raster over the base has a single edge, and the coarser
  // overlapping nests never draw. It REPLACES the base in its footprint (full
  // opacity), sitting coincident so it must not fight depth → DEPTH_PAINT. Skip it
  // when it's the very nest already drawn as the promoted base (single active nest).
  const finest = pickBestFitLoaded(entries, buildNest, resolve, camera);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (finest && finest.index !== baseNestIndex) out.push(new RasterLayer({ ...finest.props, image: finest.image as any, parameters: DEPTH_PAINT }));
  return out;
}

/**
 * From resolver entries `[base, ...nests]` (nests coarsest→finest), find the first
 * nest (scanning in `dir` direction over the nest range) whose props build AND
 * whose texture is already loaded. Returns its props + image + index, or null when
 * no nest is active/ready. Shared by the scalar + vector builders.
 */
function pickLoadedNest<P extends { image: string }>(
  entries: WeatherVariableManifest[],
  build: (entry: WeatherVariableManifest, index: number) => P | null,
  resolve: TextureResolver,
  dir: "finest" | "coarsest",
): { props: P; image: LoadedTexture; index: number } | null {
  const from = dir === "finest" ? entries.length - 1 : 1;
  const to = dir === "finest" ? 1 : entries.length - 1;
  const step = dir === "finest" ? -1 : 1;
  for (let i = from; dir === "finest" ? i >= to : i <= to; i += step) {
    const props = build(entries[i], i);
    if (!props) continue;
    const image = resolve(props.image);
    if (!image) continue;
    return { props, image, index: i };
  }
  return null;
}

/**
 * BEST-FIT winner: of the active+loaded nests, the finest-resolution one whose bbox
 * fully COVERS the central view (`viewCentralBbox`). Picking by coverage-then-resolution
 * (not manifest priority order) means the UK gets ukv/dmi — a fine nest that spans all of
 * Britain — instead of a higher-priority nest like arome-france whose edge cuts across the
 * landmass and leaves a seam with the base above it. Returns null when no active nest
 * covers the view (→ only the base draws, never a mid-scene seam). Ties break on priority.
 */
function pickBestFitLoaded<P extends { image: string }>(
  entries: WeatherVariableManifest[],
  build: (entry: WeatherVariableManifest, index: number) => P | null,
  resolve: TextureResolver,
  camera: ResolverCamera,
): { props: P; image: LoadedTexture; index: number } | null {
  // Pure ranking (coverage-gated, finest-first) → draw the first whose texture is loaded.
  for (const nest of rankNestsByFit(entries, camera)) {
    const index = entries.indexOf(nest);
    const props = build(nest, index);
    if (!props) continue;
    const image = resolve(props.image);
    if (!image) continue;
    return { props, image, index };
  }
  return null;
}

/** The COARSEST loaded nest — promoted to base when a variable has no true base. */
function pickCoarsestLoaded<P extends { image: string }>(
  entries: WeatherVariableManifest[],
  build: (entry: WeatherVariableManifest, index: number) => P | null,
  resolve: TextureResolver,
) {
  return pickLoadedNest(entries, build, resolve, "coarsest");
}

/**
 * Regional-nest aware vector particles (wind, ocean current): the global base
 * plus every ACTIVE nest at the current camera, finest last. Each nest is the
 * same ParticleLayer clipped to its `bbox`.
 */
export function vectorParticleLayers(
  manifest: WeatherManifest,
  variableId: string,
  fhr: number,
  resolve: TextureResolver,
  camera: ResolverCamera,
  opts?: Parameters<typeof vectorParticleProps>[3],
): ParticleLayer[] {
  const entries = resolveEntries(manifest.variables[variableId], camera);
  const out: ParticleLayer[] = [];
  const buildNest = (e: WeatherVariableManifest, i: number) =>
    e.bbox ? vectorParticlePropsFromEntry(e, variableId, fhr, e.bbox, { ...opts, idSuffix: `-${e.sourceId ?? `n${i}`}` }) : null;
  // Base (entries[0]) fills the globe.
  const base = entries[0];
  const baseBounds = base ? manifestBounds(manifest) : undefined;
  let baseNestIndex = -1;
  if (base && baseBounds) {
    const props = vectorParticlePropsFromEntry(base, variableId, fhr, baseBounds, { ...opts, idSuffix: "" });
    const image = props && resolve(props.image);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (props && image) out.push(new ParticleLayer({ ...props, image: image as any, parameters: DEPTH_TEST }));
    else {
      // No true global base — promote the coarsest loaded nest (icon-global spans the
      // globe) to base so wind still flows worldwide under the fine regional nest.
      const coarse = pickCoarsestLoaded(entries, buildNest, resolve);
      if (coarse) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        out.push(new ParticleLayer({ ...coarse.props, image: coarse.image as any, parameters: DEPTH_TEST }));
        baseNestIndex = coarse.index;
      }
    }
  }
  // Only the finest available nest particles draw — same single-winner rule as the
  // scalar raster, so overlapping regional wind fields don't stack (see there).
  const finest = pickBestFitLoaded(entries, buildNest, resolve, camera);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (finest && finest.index !== baseNestIndex) out.push(new ParticleLayer({ ...finest.props, image: finest.image as any, parameters: DEPTH_TEST }));
  return out;
}

export function pressureLayers(
  manifest: WeatherManifest,
  fhr: number,
  resolve: TextureResolver,
  opts?: Parameters<typeof pressureProps>[2],
): Array<ContourLayer | HighLowLayer> {
  const props = pressureProps(manifest, fhr, opts);
  if (!props) return [];
  const image = resolve(props.contour.image);
  if (!image) return [];
  // Depth-tested so far-side isobars/H-L markers are occluded by the depth
  // sphere rather than showing through the front of the globe.
  return [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new ContourLayer({ ...props.contour, image: image as any, parameters: DEPTH_TEST }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new HighLowLayer({ ...props.highLow, image: image as any, parameters: DEPTH_TEST }),
  ];
}

/**
 * The full-globe hypsometric RELIEF raster (the "Relief" basemap, and the depth
 * sealer for the contour overlay). Full opacity paints the shaded relief map;
 * `opacity: 0` makes an INVISIBLE depth-only sealer so the contour lines aren't
 * culled by the basemap sphere when there's no other full-globe raster (the
 * WeatherLayers surface sits a hair behind deck's basemap polygon, so something
 * must write depth AT that surface). Static/fhr-agnostic. Returns null if the
 * elevation texture isn't loaded yet.
 */
export function elevationReliefLayer(
  manifest: WeatherManifest,
  resolve: TextureResolver,
  opts?: { opacity?: number },
): RasterLayer | null {
  const entry = manifest.variables.elevation;
  if (!entry) return null;
  const rp = scalarRasterPropsFromEntry(entry, "elevation", 0, manifestBounds(manifest), {
    opacity: opts?.opacity ?? 1,
    idSuffix: "-relief",
  });
  const image = rp && resolve(rp.image);
  if (!rp || !image) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new RasterLayer({ ...rp, image: image as any, parameters: DEPTH_OCCLUDE });
}

/**
 * Static elevation contour LINE overlay (topographic + bathymetric), fhr-agnostic.
 * Lines only — the filled look is the "Relief" basemap / `elevationReliefLayer`.
 * Colour/width/opacity/spacing come from `opts` (ElevationSettings). No HighLow
 * markers (terrain has no "H/L" like pressure).
 */
export function elevationLayers(
  manifest: WeatherManifest,
  resolve: TextureResolver,
  opts?: Parameters<typeof elevationProps>[1],
): ContourLayer[] {
  const props = elevationProps(manifest, opts);
  if (!props) return [];
  const image = resolve(props.contour.image);
  if (!image) return [];
  // Depth-tested so far-side contour lines are occluded rather than bleeding
  // through the front of the globe.
  return [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new ContourLayer({ ...props.contour, image: image as any, parameters: DEPTH_TEST }),
  ];
}

export function cityLayer(
  cities: City[],
  subsolar?: [number, number],
): Array<ScatterplotLayer> {
  const props = cityProps(cities, subsolar);
  // When the sun moves, the per-city night factor changes → recompute the dot
  // radius/colour. Keyed to the subsolar point (rounded, so it retriggers as the
  // terminator advances but not on every identical rebuild).
  const nightKey = subsolar ? `${subsolar[0].toFixed(1)},${subsolar[1].toFixed(1)}` : "off";
  // Dots only. City NAME labels are drawn by the HTML overlay (GlobeLabels), not
  // a TextLayer — deck's font atlases come back blank under the _GlobeView build.
  return [
    new ScatterplotLayer({
      ...props.scatter,
      radiusUnits: "pixels",
      radiusMinPixels: 2,
      stroked: true,
      lineWidthMinPixels: 1,
      getLineColor: [0, 0, 0, 180],
      pickable: false,
      parameters: DEPTH_TEST,
      updateTriggers: { getRadius: nightKey, getFillColor: nightKey },
    }),
  ];
}
