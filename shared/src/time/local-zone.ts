/**
 * "What time is it THERE" — the local clock for an on-air place.
 *
 * A broadcast that frames a country, a warning, a quake or an erupting volcano
 * should say what the local time is at that place, not only UTC. Everything here
 * is PURE (the instant is always passed in) so it is unit-testable and safe on
 * both the server compose and the ticking client.
 *
 * Two grades of answer, in preference order:
 *
 *  • `city`      — a real IANA zone id read off the nearest catalogued city
 *                  (GeoNames ships one per row; see cities/geonames.ts). Correct
 *                  through DST and half-hour offsets (India +5:30, Nepal +5:45).
 *  • `longitude` — the crude round(lng/15) offset used elsewhere in the repo
 *                  (placeRoundups/localTime.ts, weather-forecast day buckets).
 *                  No DST, no political borders — the fallback for mid-ocean
 *                  shots and any place with no catalogued city nearby.
 *
 * The grade travels WITH the reading so the on-air row can be honest about it:
 * a longitude guess is captioned "approx" rather than presented as the real
 * local clock.
 */

/** Where a local-time reading came from — see the module header. */
export type LocalZoneSource = "city" | "longitude";

/** A resolved local clock for one place on the globe. */
export interface LocalZone {
  /** IANA zone id ("Asia/Tokyo") when one was resolved, else null. */
  timezone: string | null;
  /** Whole-hour UTC offset from longitude — the reading when `timezone` is null. */
  offsetHours: number;
  /** Which grade of answer this is. */
  source: LocalZoneSource;
  /** The place the zone was read from ("Tokyo") — caption only, may be absent. */
  from?: string;
}

/** PURE: the crude whole-hour UTC offset for a longitude, clamped to real-world
 *  extremes (-12…+14). `|| 0` normalises -0 → 0 so it never formats as "UTC-0". */
export function longitudeOffsetHours(lng: number): number {
  if (!Number.isFinite(lng)) return 0;
  return Math.max(-12, Math.min(14, Math.round(lng / 15))) || 0;
}

/** PURE: the fallback zone for a point with no catalogued city near it. */
export function zoneFromLongitude(lng: number): LocalZone {
  return { timezone: null, offsetHours: longitudeOffsetHours(lng), source: "longitude" };
}

/** PURE: a zone read off a named place's IANA id, with the longitude offset kept
 *  as the fallback reading if the id turns out to be unknown to this runtime. */
export function zoneFromCity(timezone: string, lng: number, from?: string): LocalZone {
  return { timezone, offsetHours: longitudeOffsetHours(lng), source: "city", from };
}

/**
 * PURE: a zone's real offset from UTC in MINUTES at a given instant — the DST-
 * aware, half-hour-capable number `timezone` exists to give us.
 *
 * Derived by formatting the instant in the target zone and reading the wall
 * clock back as if it were UTC: the gap between that and the true instant IS the
 * offset. (`timeZoneName: "longOffset"` would be shorter but is not universally
 * available, and OBS's embedded Chromium is not a runtime to gamble on.)
 *
 * Returns null for an id this runtime does not know, so callers fall back.
 */
export function zoneOffsetMinutes(timezone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const y = get("year");
    const mo = get("month");
    const d = get("day");
    const h = get("hour");
    const mi = get("minute");
    const s = get("second");
    if (![y, mo, d, h, mi, s].every(Number.isFinite)) return null;
    // Date.UTC's two-digit-year window only bites below 100; on-air dates never do.
    const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    return null; // unknown/invalid IANA id on this runtime
  }
}

/** PURE: the zone's offset in minutes at an instant, falling back to the
 *  longitude estimate when there's no usable IANA id. */
export function localOffsetMinutes(zone: LocalZone, at: Date): number {
  if (zone.timezone) {
    const real = zoneOffsetMinutes(zone.timezone, at);
    if (real != null) return real;
  }
  return zone.offsetHours * 60;
}

/** PURE: the local wall clock as a Date whose UTC accessors read as local time.
 *  Only ever read with `getUTC*` — never as a real instant. */
function localWallClock(zone: LocalZone, at: Date): Date {
  return new Date(at.getTime() + localOffsetMinutes(zone, at) * 60_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** PURE: "14:32" (24-hour) at the place, or "14:32:07" with `seconds`. */
export function formatLocalTime(zone: LocalZone, at: Date, seconds = false): string {
  const w = localWallClock(zone, at);
  const hm = `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
  return seconds ? `${hm}:${pad(w.getUTCSeconds())}` : hm;
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** PURE: the local weekday abbreviation ("THU") at the place — the day can differ from
 *  the viewer's, which is half the point of showing the clock at all. */
export function formatLocalDay(zone: LocalZone, at: Date): string {
  return WEEKDAYS[localWallClock(zone, at).getUTCDay()];
}

/** PURE: "UTC+9", "UTC-4:30", "UTC" — the offset badge beside the reading. */
export function formatOffsetLabel(zone: LocalZone, at: Date): string {
  const mins = localOffsetMinutes(zone, at);
  if (mins === 0) return "UTC";
  const sign = mins < 0 ? "-" : "+";
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m ? `UTC${sign}${h}:${pad(m)}` : `UTC${sign}${h}`;
}

/** Longest place name the caption will carry before it is clipped — the on-air
 *  row is one line in a 420-px card, and "Petropavlovsk-Kamchatsky" would push
 *  the reading itself off the edge. */
const CAPTION_NAME_MAX = 16;

/**
 * PURE: the caption under an on-air local-time reading — where the zone came
 * from, and whether it can be trusted to the minute. A city-sourced zone names
 * the city; a longitude guess says so rather than pretending.
 */
export function localZoneCaption(zone: LocalZone, at: Date): string {
  const offset = formatOffsetLabel(zone, at);
  if (zone.source !== "city") return `${offset} approx`;
  const name = (zone.from ?? "").trim();
  if (!name) return offset;
  // Clip back to a word/hyphen boundary where there is one near the limit, so a
  // long double-barrelled name reads "Petropavlovsk…" and not "Petropavlovsk-K…".
  const clip = name.slice(0, CAPTION_NAME_MAX - 1).replace(/[\s-][^\s-]*$/, "").replace(/[\s-]+$/, "");
  const short =
    name.length > CAPTION_NAME_MAX
      ? `${(clip.length >= CAPTION_NAME_MAX / 2 ? clip : name.slice(0, CAPTION_NAME_MAX - 1).trimEnd())}…`
      : name;
  return `${offset} · ${short}`;
}
