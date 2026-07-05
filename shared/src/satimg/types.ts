/**
 * Satellite-imagery ("live-ish" geostationary) overlay domain types, shared by the
 * worker (ingest / bake) and the public app (overlay). The worker pulls raw
 * full-disk imagery from an open feed (Himawari-9 on AWS S3 first), reprojects the
 * geostationary disk onto a full-globe plate-carrée canvas via a satpy sidecar,
 * bakes it to an RGBA PNG (transparent outside the disk), and stores ONE cached
 * frame PER satellite in Mongo. The public app only ever reads those cached frames
 * (same rule as aurora / faults / cables — the app never calls the raw feed).
 *
 * Unlike aurora's single global oval, this is keyed by `satId` so more birds
 * (GOES-19/18, MTG/MSG-IODC …) bolt on later as additional frames and the overlay
 * simply drapes each disk over its own footprint — together covering the globe.
 */

/** [west, south, east, north] in degrees — a baked PNG's geographic extent. */
export type SatImgBounds = [number, number, number, number];

/**
 * Full-globe plate-carrée canvas every disk is reprojected onto. Baking each
 * satellite onto identical global bounds means the client draws every frame with
 * the SAME geometry as the working base-map image layer (a full-globe BitmapLayer),
 * so a coarse-tessellation limb artefact can't appear on a partial-bounds quad.
 * The disk simply paints where it has data and stays transparent elsewhere.
 */
export const SATIMG_GLOBAL_BOUNDS: SatImgBounds = [-180, -90, 180, 90];

/** A geostationary satellite the worker can ingest. */
export interface SatImgSat {
  /** Stable slug + Mongo singleton key for this bird's cached frame. */
  id: string;
  /** Display name for the HUD / operator UI. */
  name: string;
  /** Sub-satellite longitude (°E) — the centre of its Earth disk. */
  subLon: number;
  /** Human region tags the disk covers (for operator context only). */
  regions: string[];
}

/**
 * The bird registry. Himawari-9 ships first (keyless AWS S3, ~15–20 min fresh,
 * covers Asia + Australia + eastern China + far-eastern Russia in one feed). The
 * commented birds are the planned expansion — add the ingest adapter, then a row
 * here, and the overlay picks them up with no client change.
 */
export const SATIMG_SATS: Record<string, SatImgSat> = {
  himawari9: {
    id: "himawari9",
    name: "Himawari-9",
    subLon: 140.7,
    regions: ["Asia", "Australia", "E China", "far-E Russia", "W Pacific"],
  },
  // goes19:  { id: "goes19",  name: "GOES-19",       subLon: -75.2, regions: ["Americas", "Atlantic", "W Africa edge"] },
  // goes18:  { id: "goes18",  name: "GOES-18",       subLon: -137,  regions: ["Pacific", "W Americas"] },
  // mtg0:    { id: "mtg0",    name: "Meteosat-12",   subLon: 0,     regions: ["Africa", "Europe"] },
  // msgIodc: { id: "msgIodc", name: "Meteosat-9",    subLon: 45.5,  regions: ["E Africa", "India", "W Asia"] },
};

/** Metadata for one baked satellite frame (no pixel bytes). */
export interface SatImgFrame {
  /** Bird slug (registry key), e.g. "himawari9". */
  satId: string;
  /** Display name, e.g. "Himawari-9". */
  satName: string;
  /** Sub-satellite longitude (°E) the disk is centred on. */
  subLon: number;
  /** satpy composite/band baked, e.g. "true_color" or "B13" (clean IR). */
  composite: string;
  /** Nominal scan-slot / observation time (ISO) the imagery is from. */
  observationTime: string;
  /** Geographic extent of the baked PNG (always the full globe — see above). */
  bounds: SatImgBounds;
  /** Baked canvas width (columns). */
  width: number;
  /** Baked canvas height (rows). */
  height: number;
}

/** What the overlay hook receives: frame metadata plus a cache-bust key. */
export interface SatImgMeta extends SatImgFrame {
  /** When the worker last baked this frame (ISO) — busts the image URL cache. */
  updatedAt: string;
}

/**
 * One selectable "clouds" FEED — a source + its coverage area. The worker bakes each
 * feed into its own cached frame (satId = feed id); the operator ticks which feeds to
 * show and sets each one's opacity. `bounds` is both the fetch window and the globe
 * BitmapLayer extent (imagery is transparent outside its disk, so a generous window is
 * fine). Live geostationary feeds refresh ~10-min; the global mosaic is daily.
 */
export interface SatImgFeed {
  id: string;
  label: string;
  region: string;
  bounds: SatImgBounds;
  live: boolean;
}

/**
 * The feed set the globe can drape. NASA GIBS (keyless WMS) serves the global daily
 * true-colour mosaic + live GOES-East/West GeoColor + Himawari clean-IR; EUMETSAT's
 * (also keyless) EUMETView WMS fills the missing third of the planet with the Meteosat
 * discs — MTG GeoColor at 0° (Europe/Africa/Atlantic) and MSG clean-IR over the Indian
 * Ocean (45.5°E). Together the four live discs + the daily mosaic wrap the whole globe.
 */
export const SATIMG_FEEDS: SatImgFeed[] = [
  { id: "global", label: "Global true colour", region: "Whole world · daily", bounds: [-180, -90, 180, 90], live: false },
  { id: "goes-east", label: "GOES-East", region: "Americas · Atlantic · live", bounds: [-150, -65, 10, 65], live: true },
  { id: "goes-west", label: "GOES-West", region: "Pacific · W Americas · live", bounds: [-180, -65, -60, 65], live: true },
  { id: "himawari", label: "Himawari (IR)", region: "Asia · Australia · live", bounds: [60, -65, 180, 65], live: true },
  { id: "meteosat-0", label: "Meteosat-0 (GeoColor)", region: "Europe · Africa · Atlantic · live", bounds: [-65, -65, 65, 65], live: true },
  { id: "meteosat-iodc", label: "Meteosat IODC (IR)", region: "Indian Ocean · E Africa · S Asia · live", bounds: [-25, -65, 116, 65], live: true },
];

/** Per-feed operator state: shown + its own opacity. */
export interface SatImgFeedState {
  on: boolean;
  opacity: number;
}

/** Default per-feed state — the global mosaic on, the live regional discs off. */
export const DEFAULT_SATIMG_FEEDS: Record<string, SatImgFeedState> = {
  global: { on: true, opacity: 0.85 },
  "goes-east": { on: false, opacity: 0.9 },
  "goes-west": { on: false, opacity: 0.9 },
  himawari: { on: false, opacity: 0.9 },
  "meteosat-0": { on: false, opacity: 0.9 },
  "meteosat-iodc": { on: false, opacity: 0.9 },
};

/** Fresh deep copy of the default feed state (so callers never share nested refs). */
export function defaultSatImgFeeds(): Record<string, SatImgFeedState> {
  const out: Record<string, SatImgFeedState> = {};
  for (const [id, s] of Object.entries(DEFAULT_SATIMG_FEEDS)) out[id] = { ...s };
  return out;
}
