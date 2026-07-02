/**
 * Real sea-level / tide-gauge data for the broadcast "TSUNAMI GAUGE". Point
 * stations with a recent water-level time-series, so the on-air gauge draws the
 * genuine tidal curve of the coast nearest whatever's on screen instead of a
 * decorative sine. `provider` is normalised so IOC (global), NOAA CO-OPS (US)
 * or DART buoys can coexist behind one shape.
 */

/** Where a station's data comes from. IOC is the global coastal-gauge network. */
export type TideProvider = "ioc" | "coops" | "dart";

/** A tide/sea-level gauge in the station catalog. */
export interface TideStation {
  /** Provider-native station id (the upsert key), e.g. IOC code "abas". */
  stationId: string;
  provider: TideProvider;
  /** Human-readable station name, e.g. "Abashiri". */
  name: string;
  lng: number;
  lat: number;
  /** ISO-3166-ish country code when the provider gives one. */
  country?: string;
  /**
   * Provider sensor channel to read the water level from (IOC exposes several
   * per station, e.g. "prs"/"rad"). Stored so the series fetch reads the right
   * channel without re-guessing.
   */
  sensor?: string;
}

/** One water-level reading: epoch ms + metres. */
export interface TideSample {
  t: number;
  v: number;
}

/** A station's recent water-level series, as cached and served to the gauge. */
export interface TideSeries {
  stationId: string;
  provider: TideProvider;
  name: string;
  lng: number;
  lat: number;
  /** Always metres — adapters normalise. */
  unit: "m";
  /** Oldest → newest. */
  samples: TideSample[];
  /** Most-recent value (samples[last].v), for a quick readout. */
  latest: number;
  /** When the worker last refreshed this series (epoch ms). */
  updatedAt: number;
}
