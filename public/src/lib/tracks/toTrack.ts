import type { Aircraft, SatellitePosition, Ship, Track } from "./types";

/** Per-kind overlay colours (match the admin accents). */
export const TRACK_COLORS: Record<Track["kind"], [number, number, number]> = {
  satellite: [56, 189, 248], // cyan
  aircraft: [250, 204, 21], // amber
  ship: [34, 197, 94], // green
};

export function satelliteToTrack(s: SatellitePosition): Track {
  return {
    id: `sat:${s.noradId}`,
    kind: "satellite",
    name: s.name,
    // altitude km → metres so it floats above the sphere at true scale.
    position: [s.lng, s.lat, s.altKm * 1000],
    color: TRACK_COLORS.satellite,
  };
}

export function aircraftToTrack(a: Aircraft): Track {
  return {
    id: `ac:${a.icao24}`,
    kind: "aircraft",
    name: a.callsign,
    position: [a.lng, a.lat, a.altM ?? 0],
    heading: a.headingDeg,
    color: TRACK_COLORS.aircraft,
  };
}

export function shipToTrack(s: Ship): Track {
  return {
    id: `ship:${s.mmsi}`,
    kind: "ship",
    name: s.name,
    position: [s.lng, s.lat, 0],
    heading: s.headingDeg ?? s.cogDeg,
    color: TRACK_COLORS.ship,
  };
}
