import type { SeismoStation } from "./types";

/**
 * FDSN station discovery for the Global Seismographic Network (IU/II/IC —
 * broadband, globally distributed backbone stations; not the full FDSN
 * federation, which is too dense/uneven for a "nearest station anywhere on
 * Earth" lookup). `service.iris.edu` 307-redirects here now; pointing at
 * EarthScope directly skips that hop. Text output only — this endpoint has
 * no JSON format.
 */
const BASE = "https://service.earthscope.org/fdsnws/station/1/query";
const UA = "LiveWeatherGlobe/0.1 (personal weather globe)";
const NETWORKS = "IU,II,IC";
/** Prefer a vertical broadband channel; HH? is the backup where BH? is absent. */
const CHANNELS = "BHZ,HHZ";

interface RawChannel {
  key: string; // net.sta
  loc: string;
  cha: string;
  lat: number;
  lng: number;
  elevation?: number;
  sampleRateHz?: number;
}

const num = (v: string): number | undefined => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Skip the leading `#...` header row(s) and blank lines of a text response. */
const dataRows = (text: string): string[][] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("|"));

/**
 * Parse a `level=channel&format=text` response (columns: Network|Station|
 * Location|Channel|Latitude|Longitude|Elevation|Depth|Azimuth|Dip|
 * SensorDescription|Scale|ScaleFreq|ScaleUnits|SampleRate|StartTime|EndTime).
 * One row per currently-open channel epoch when queried with `starttime`/
 * `endtime` pinned to "now".
 */
export function parseChannels(text: string): RawChannel[] {
  const out: RawChannel[] = [];
  for (const cols of dataRows(text)) {
    if (cols.length < 15) continue;
    const [net, sta, loc, cha, latS, lngS, , , , , , , , , rateS] = cols;
    const lat = num(latS);
    const lng = num(lngS);
    if (!net || !sta || lat === undefined || lng === undefined) continue;
    out.push({ key: `${net}.${sta}`, loc: loc ?? "", cha, lat, lng, sampleRateHz: num(rateS) });
  }
  return out;
}

/**
 * Parse a `level=station&format=text` response (columns: Network|Station|
 * Latitude|Longitude|Elevation|SiteName|StartTime|EndTime) into a
 * `net.sta` → human-readable site name map.
 */
export function parseStationNames(text: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const cols of dataRows(text)) {
    if (cols.length < 6) continue;
    const [net, sta, , , , siteName] = cols;
    if (net && sta && siteName) names.set(`${net}.${sta}`, siteName);
  }
  return names;
}

/**
 * One representative broadband channel per station — the ONLY channel we'll
 * SeedLink-stream for it. Prefers BHZ over HHZ, then the "00" location code
 * (IRIS's usual primary epoch) over any other, so a station with several
 * co-located sensors (e.g. ANMO's "00"/"10") yields exactly one catalog entry.
 */
function pickChannel(channels: RawChannel[]): RawChannel {
  const rank = (c: RawChannel) => (c.cha.startsWith("BH") ? 0 : 1) * 10 + (c.loc === "00" ? 0 : c.loc === "" ? 1 : 2);
  return [...channels].sort((a, b) => rank(a) - rank(b))[0];
}

/** Fetch the current GSN broadband station catalog (one entry per station). */
export async function fetchStations(): Promise<SeismoStation[]> {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "");
  const q = new URLSearchParams({
    net: NETWORKS,
    cha: CHANNELS,
    level: "channel",
    format: "text",
    starttime: now,
    endtime: now,
  });
  const [chanRes, nameRes] = await Promise.all([
    fetch(`${BASE}?${q.toString()}`, { headers: { "User-Agent": UA } }),
    fetch(`${BASE}?${new URLSearchParams({ net: NETWORKS, level: "station", format: "text" }).toString()}`, {
      headers: { "User-Agent": UA },
    }),
  ]);
  if (!chanRes.ok) throw new Error(`fdsn station (channel) failed: ${chanRes.status} ${chanRes.statusText}`);
  if (!nameRes.ok) throw new Error(`fdsn station (station) failed: ${nameRes.status} ${nameRes.statusText}`);

  const channels = parseChannels(await chanRes.text());
  const names = parseStationNames(await nameRes.text());

  const byStation = new Map<string, RawChannel[]>();
  for (const c of channels) {
    const list = byStation.get(c.key) ?? [];
    list.push(c);
    byStation.set(c.key, list);
  }

  const out: SeismoStation[] = [];
  for (const [key, list] of byStation) {
    const [net, sta] = key.split(".");
    const chosen = pickChannel(list);
    out.push({
      net,
      sta,
      loc: chosen.loc,
      cha: chosen.cha,
      lat: chosen.lat,
      lng: chosen.lng,
      elevation: chosen.elevation,
      siteName: names.get(key),
    });
  }
  return out;
}
