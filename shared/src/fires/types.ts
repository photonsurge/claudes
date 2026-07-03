/**
 * Active-fire (thermal anomaly) domain types, shared by the worker (ingest) and
 * the public app (overlay). Fires are point-in-time satellite detections (NASA
 * FIRMS: VIIRS/MODIS hot-spots), so — like earthquakes — the worker upserts them
 * into Mongo on a fast cron and the public app only ever reads the cache.
 */

/** One active-fire detection. */
export interface Fire {
  /** Deterministic id minted from satellite + position + acquisition time. */
  id: string;
  lat: number;
  lng: number;
  /** Fire radiative power (MW) — the energy of the fire; drives size + colour. */
  frp: number;
  /** Brightness temperature (K) of the fire channel. */
  brightness: number;
  /** Detection confidence 0–100 (VIIRS low/nominal/high folded to 30/60/90). */
  confidence: number;
  /** Acquisition time (epoch ms, UTC). */
  acqTime: number;
  /** "D" day / "N" night (blank if unknown). */
  daynight: "D" | "N" | "";
  /** Source satellite tag from the feed (e.g. "N", "1", "Terra", "Aqua"). */
  satellite: string;
}

/** Everything the fire overlay needs in one cached payload. */
export interface FireData {
  fires: Fire[];
}
