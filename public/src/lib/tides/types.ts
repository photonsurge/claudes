export * from "@photonsurge/shared/tides/types";

import type { TideProvider, TideSample } from "@photonsurge/shared/tides/types";

/** `/api/tracks/tide` response — the nearest cached gauge to a point, or none. */
export interface TideGaugeResponse {
  station: {
    stationId: string;
    provider: TideProvider;
    name: string;
    lat: number;
    lng: number;
    /** Distance from the queried point, km. */
    distanceKm: number;
  } | null;
  unit?: "m";
  latest?: number;
  samples?: TideSample[];
  updatedAt?: number;
  error?: string;
}
