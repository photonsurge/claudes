/**
 * Live-tracks domain types. The first source is satellites; aircraft + ships
 * will reuse `Track` so one overlay layer renders them all (map comes later).
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

/** A live aircraft state (ADS-B via OpenSky). */
export interface Aircraft {
  icao24: string;
  callsign?: string;
  country?: string;
  /** Degrees. */
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
}

/** A live vessel position (AIS via aisstream.io). */
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

/** A generic moving entity for the (future) overlay layer. */
export interface Track {
  id: string;
  kind: TrackKind;
  name?: string;
  /** [lng, lat, altMeters?]. */
  position: [number, number, number?];
  heading?: number;
  color?: [number, number, number];
}
