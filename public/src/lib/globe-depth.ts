/**
 * Far clip plane for high orbits on the deck GlobeView.
 *
 * GlobeViewport sizes its own far plane for the PLANET and nothing else:
 *
 *   far = cameraAltitude + (GLOBE_RADIUS · 2 · scale) / heightPx
 *
 * — camera distance plus one globe diameter, which is exactly enough to reach the
 * sphere's far limb. Anything drawn further out than the back of the planet is
 * clipped by the GPU, and orbit shells are drawn at TRUE altitude: a GPS ring
 * sits 3.2 Earth radii out, a geostationary ring 6.6. Measured against the real
 * viewport at the framings the director used, the far plane was cutting 42% of a
 * GPS ring and half a GEO ring — the back of every medium and high orbit simply
 * was not there.
 *
 * `orbitFarZ` returns the distance that reaches the back of the shell instead, or
 * undefined to leave deck's default alone. It only ever pushes the plane OUT, and
 * only when something is actually drawn beyond the planet, so low-Earth framings
 * (every shell inside ~6600 km) keep the tight depth range — and with it the
 * depth precision the basemap and its draped overlays are tuned against.
 */

/** deck's globe is a sphere of this many common-space units (GlobeViewport). */
const GLOBE_RADIUS = 256;
/** Earth radius in metres, as GlobeViewport measures altitude against. */
const EARTH_RADIUS_M = 6370972;
/**
 * Camera distance, in view units, from the point on the SURFACE under the camera
 * — deck centres the globe view there, not on the planet's centre, which is why
 * its own far plane comes out as this plus two radii (surface → centre → far
 * limb). A shell k radii out therefore sits at altitude + (1 + k) radii.
 */
const CAMERA_ALTITUDE = 1.5;
/** Push the plane a hair past the shell so the backmost vertex isn't on it. */
const MARGIN = 1.02;
/**
 * Beyond this shell radius (view units — the frame's half-height is 0.5) the ring
 * is many frame-heights wide and nothing of it is on screen, so stretching the
 * depth range to reach it would trade real precision for nothing. Zoomed-in shots
 * with satellites on are the case that hits this.
 */
const MAX_USEFUL_SHELL = 4;

/** GlobeViewport's world scale at this zoom and latitude. */
function globeScale(zoom: number, latitude: number): number {
  return Math.pow(2, zoom) / (Math.PI * Math.cos((latitude * Math.PI) / 180));
}

export interface OrbitFarZOptions {
  zoom: number;
  latitude: number;
  /** Viewport height in CSS pixels — deck's far plane is scaled by it. */
  height: number;
  /** Highest orbit altitude currently drawn, in metres (0 = no orbits). */
  maxAltitudeM: number;
}

/**
 * Far plane that keeps a shell at `maxAltitudeM` inside the frustum, or undefined
 * when deck's own far plane already reaches it.
 */
export function orbitFarZ({ zoom, latitude, height, maxAltitudeM }: OrbitFarZOptions): number | undefined {
  if (!(maxAltitudeM > 0) || !(height > 0) || !Number.isFinite(zoom)) return undefined;
  const scale = globeScale(zoom, latitude);
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  // Radius of the orbit shell and of the planet, in view units.
  const shell = ((maxAltitudeM / EARTH_RADIUS_M + 1) * GLOBE_RADIUS * scale) / height;
  const planet = (GLOBE_RADIUS * scale) / height;
  if (shell > MAX_USEFUL_SHELL) return undefined;
  // Surface → globe centre is one planet radius; centre → the back of the shell
  // is the shell's. Nothing drawn on the shell can be deeper than that.
  const needed = (CAMERA_ALTITUDE + planet + shell) * MARGIN;
  const deckDefault = CAMERA_ALTITUDE + planet * 2;
  return needed > deckDefault ? needed : undefined;
}
