/**
 * Real seismometer waveform data for the broadcast "SEISMIC MONITOR". Station
 * metadata comes from the FDSN station service (near-static, refreshed daily);
 * live amplitude samples are streamed over SeedLink and cached per in-focus
 * channel, so the on-air trace draws the genuine ground-motion reading of the
 * station nearest an earthquake instead of a decorative sine wave.
 */

/** A broadband seismometer channel in the station catalog. */
export interface SeismoStation {
  net: string;
  sta: string;
  loc: string;
  cha: string;
  lat: number;
  lng: number;
  elevation?: number;
  siteName?: string;
}

/** One amplitude reading: epoch ms + raw counts (STEIM-decoded). */
export interface SeismoSample {
  t: number;
  v: number;
}

/** A station's recent live-streamed waveform, as cached and served to the panel. */
export interface SeismoSeries {
  net: string;
  sta: string;
  loc: string;
  cha: string;
  lat: number;
  lng: number;
  siteName?: string;
  sampleRateHz: number;
  /** Oldest → newest, trimmed to a rolling window. */
  samples: SeismoSample[];
  /** Most-recent value (samples[last].v), for a quick readout. */
  latest: number;
  /** When the worker last appended to this series (epoch ms). */
  updatedAt: number;
}
