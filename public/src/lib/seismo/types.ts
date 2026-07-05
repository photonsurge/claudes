export * from "@photonsurge/shared/seismo/types";

import type { SeismoSample } from "@photonsurge/shared/seismo/types";

/** One entry in `/api/tracks/seismo`'s `stations` array. */
export interface SeismoStationReading {
  net: string;
  sta: string;
  loc: string;
  cha: string;
  siteName?: string;
  lat: number;
  lng: number;
  /** Distance from the queried point, km. */
  distanceKm: number;
  sampleRateHz: number;
  samples: SeismoSample[];
  latest: number;
  updatedAt: number;
}

/** `/api/tracks/seismo` response — the nearby cached live stations, or none. */
export interface SeismoStationsResponse {
  stations: SeismoStationReading[];
  error?: string;
}
