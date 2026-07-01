/**
 * Depth-buffer parameters for the globe layers — the single thing that stops the
 * planet rendering "see-through" (the far hemisphere bleeding over the front).
 *
 * deck.gl 9 runs on luma.gl 9, whose render pipeline reads `depthCompare` /
 * `depthWriteEnabled`. The luma 8 `depthTest: true|false` boolean these layers
 * used to pass is NOT a recognised key and is silently dropped — so it never did
 * anything. Worse, WeatherLayers builds its raster/particle sublayers with
 * `parameters: { depthCompare: "always", ...props.parameters }`, i.e. depth test
 * OFF. Because luma 9 shares one WebGL depth state, the whole-globe weather
 * raster both drew its OWN back side over the front and left depth testing
 * disabled for every layer drawn after it (and on into the next frame). The fix
 * is to state depth intent explicitly, with the v9 keys, on every globe layer —
 * which also overrides WeatherLayers' "always" (props.parameters is spread last).
 *
 * `less-equal` lets a layer at the surface draw over the basemap at the same
 * depth (later draw wins) while still being hidden when it lies on the far side.
 */

/** Solid surface that builds the depth sphere — tests AND writes depth (basemap
 *  background, land fill, the weather raster fill). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DEPTH_OCCLUDE: any = { depthTest: true, depthWriteEnabled: true, depthCompare: "less-equal" };

/** Overlay the near hemisphere should hide but that must not seal the depth
 *  buffer against the overlays layered above it (borders, graticule, cables,
 *  alerts, quakes, cities, tracks, wind/contours). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DEPTH_TEST: any = { depthTest: true, depthWriteEnabled: false, depthCompare: "less-equal" };

/** Full-globe SOLID surface fill (the draped land fill) that paints straight
 *  over whatever occluding sphere was drawn before it, ignoring depth entirely.
 *  Its far hemisphere is hidden geometrically by GlobeView's `cullMode: 'back'`
 *  (back-facing triangles are culled), so it needs no depth test — and NOT
 *  testing avoids z-fighting between the ocean-background grid and the land
 *  grid (the "spiky fill" artifact), since the two near-coincident solids no
 *  longer compete for the same depth. Must not write depth either, so overlays
 *  above still test cleanly against the occluding sphere underneath. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DEPTH_PAINT: any = { depthTest: false, depthWriteEnabled: false, depthCompare: "always" };
