export * from "@photonsurge/shared/tides/types";

import type { TideProvider, TideSample } from "@photonsurge/shared/tides/types";

/** One entry in `/api/tracks/tide`'s `stations` array. */
export interface TideStationReading {
  stationId: string;
  provider: TideProvider;
  name: string;
  lat: number;
  lng: number;
  /** Distance from the queried point, km. */
  distanceKm: number;
  unit: "m";
  samples: TideSample[];
  latest: number;
  updatedAt: number;
}

/** `/api/tracks/tide` response — the nearby cached gauges, or none. */
export interface TideStationsResponse {
  stations: TideStationReading[];
  error?: string;
}
