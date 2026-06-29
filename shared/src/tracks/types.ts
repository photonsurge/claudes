/**
 * Live-tracks domain types, shared by the worker (ingest/persistence) and the
 * public app (overlay/admin). Satellites first; aircraft + ships reuse `Track`.
 */
export type TrackKind = "satellite" | "aircraft" | "ship";

/** A parsed TLE record (one orbiting object). */
export interface TleRecord {
  name: string;
  noradId: string;
  line1: string;
  line2: string;
}

/** A propagated satellite position at a moment in time. */
export interface SatellitePosition {
  noradId: string;
  name: string;
  /** Degrees, −180..180. */
  lng: number;
  /** Degrees, −90..90. */
  lat: number;
  /** Altitude above the ellipsoid, km. */
  altKm: number;
  /** Orbital speed, km/s. */
  speedKmS: number;
}

/** A live aircraft state (ADS-B). */
export interface Aircraft {
  icao24: string;
  callsign?: string;
  country?: string;
  lng: number;
  lat: number;
  /** Geometric (or barometric) altitude, metres. */
  altM?: number;
  /** Ground speed, m/s. */
  velocityMS?: number;
  /** True track, degrees clockwise from north. */
  headingDeg?: number;
  /** Climb/descent rate, m/s. */
  verticalRateMS?: number;
  onGround: boolean;
  // ── Static metadata (hexdb, joined from cache) ──
  /** Registration / tail number, e.g. "G-EZBC". */
  registration?: string;
  /** Aircraft type, e.g. "Boeing 737-800". */
  acType?: string;
  /** Operator / registered owner. */
  operator?: string;
}

/** A live vessel position (AIS). */
export interface Ship {
  mmsi: string;
  name?: string;
  lng: number;
  lat: number;
  /** Speed over ground, knots. */
  sogKn?: number;
  /** Course over ground, degrees. */
  cogDeg?: number;
  /** True heading, degrees. */
  headingDeg?: number;
}

/**
 * A seismic event (earthquake). Point-in-time, not a moving track — sized by
 * magnitude and coloured by depth on the overlay rather than dead-reckoned.
 */
export interface Quake {
  /** USGS event id (e.g. "us7000abcd"). */
  id: string;
  /** Richter/moment magnitude. */
  mag: number;
  /** Human-readable location, e.g. "12km SSW of …". */
  place?: string;
  /** Event time, epoch ms (USGS reports ms). */
  time: number;
  lng: number;
  lat: number;
  /** Hypocentre depth, km. */
  depthKm: number;
  /** USGS event page. */
  url?: string;
  /** Whether USGS flagged tsunami potential. */
  tsunami?: boolean;
}

/** A generic moving entity for the overlay layer. */
export interface Track {
  id: string;
  kind: TrackKind;
  name?: string;
  /** [lng, lat, altMeters?]. */
  position: [number, number, number?];
  heading?: number;
  color?: [number, number, number];
  // ── Optional metadata, carried for the hover tooltip ──
  /** ICAO24 hex (aircraft) / MMSI (ship) / NORAD id (satellite). */
  code?: string;
  /** Registration country name (aircraft origin_country; ship MMSI MID). */
  country?: string;
  /** Flag emoji for `country`, or "" if unresolved. */
  flag?: string;
  /** Altitude, metres (aircraft geo/baro alt; satellite orbital alt). */
  altM?: number;
  /** Speed, m/s (aircraft ground speed; satellite orbital speed). */
  speedMS?: number;
  /** Ship speed over ground, knots. */
  sogKn?: number;
  /** Aircraft climb/descent rate, m/s. */
  verticalRateMS?: number;
  /** Aircraft registration / tail number. */
  registration?: string;
  /** Aircraft type, e.g. "Boeing 737-800". */
  acType?: string;
  /** Aircraft operator / registered owner. */
  operator?: string;
}
