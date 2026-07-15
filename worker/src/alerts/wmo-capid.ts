/**
 * Resolve a WMO `capurl` to the canonical national CAP identifier.
 *
 * WMO's WFS view leaves `identifier` empty on every feature, so its alerts can't
 * be matched to the same warning arriving from MeteoAlarm or NWS. The id is one
 * hop away: `capurl` addresses the original CAP XML, which carries it. Verified
 * live — WMO's `pl-imgw-xx/…` alert resolves to
 * `2.49.0.0.616.0.PL.Sk20260715120207440.PL3202`, a string present verbatim in
 * MeteoAlarm's Poland feed.
 *
 * A capurl is content-addressed (the filename is a document hash), so this
 * mapping never changes — resolve once, cache forever.
 */

const CAP_BASE = () =>
  process.env.WMO_CAP_BASE || "https://severeweather.wmo.int/v2/cap-alerts/";

const userAgent = () =>
  process.env.ALERTS_WMO_USER_AGENT ||
  "Mozilla/5.0 LiveWeatherGlobe/0.1 (personal weather globe; ravergeek@gmail.com)";

export interface CapIdResult {
  capId: string | null;
  sender?: string;
}

/** Pull `<identifier>`/`<sender>` out of a CAP XML document. */
export function parseCapIdentifier(xml: string): CapIdResult {
  // Deliberately not a full XML parse: we want two top-level scalars from a
  // document whose only purpose here is to yield them. `[\s\S]` so a value that
  // wraps across lines still matches.
  const id = /<identifier>([\s\S]*?)<\/identifier>/i.exec(xml)?.[1]?.trim();
  const sender = /<sender>([\s\S]*?)<\/sender>/i.exec(xml)?.[1]?.trim();
  return { capId: id || null, sender: sender || undefined };
}

/** Fetch and parse one capurl's CAP XML. Throws on HTTP error so callers can retry it. */
export async function fetchCapId(capurl: string): Promise<CapIdResult> {
  const res = await fetch(`${CAP_BASE()}${capurl}`, {
    headers: { "User-Agent": userAgent(), Referer: "https://severeweather.wmo.int/" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return parseCapIdentifier(await res.text());
}
