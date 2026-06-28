import type { Aircraft } from "./types";

/**
 * OpenSky Network ADS-B (spec §2 analogue for aircraft). `/states/all` returns
 * a `states` array of fixed-index tuples; we map the ones with a position.
 * Anonymous works but is rate-limited — pass a bbox to cut volume/credits, or
 * set OPENSKY_USERNAME/PASSWORD for higher limits.
 *
 * Tuple indices: 0 icao24, 1 callsign, 2 country, 5 lon, 6 lat, 7 baro_alt,
 * 8 on_ground, 9 velocity, 10 true_track, 11 vertical_rate, 13 geo_alt.
 */
export function parseStates(json: unknown): Aircraft[] {
  const states = (json as { states?: unknown[] } | null)?.states;
  if (!Array.isArray(states)) return [];

  const out: Aircraft[] = [];
  for (const s of states as unknown[][]) {
    const lng = s[5];
    const lat = s[6];
    if (typeof lng !== "number" || typeof lat !== "number") continue;
    const callsign = typeof s[1] === "string" ? s[1].trim() : "";
    out.push({
      icao24: String(s[0]),
      callsign: callsign || undefined,
      country: typeof s[2] === "string" ? s[2] : undefined,
      lng,
      lat,
      altM: (typeof s[13] === "number" ? s[13] : typeof s[7] === "number" ? s[7] : undefined) ?? undefined,
      velocityMS: typeof s[9] === "number" ? s[9] : undefined,
      headingDeg: typeof s[10] === "number" ? s[10] : undefined,
      verticalRateMS: typeof s[11] === "number" ? s[11] : undefined,
      onGround: s[8] === true,
    });
  }
  return out;
}

const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

// Cached OAuth2 token (tokens last ~30 min). Module-level on the server.
let tokenCache: { token: string; exp: number } | null = null;

/**
 * Get an OpenSky OAuth2 access token from client credentials, or null if none
 * configured. OpenSky migrated from basic-auth to OAuth2 client credentials —
 * create an "API client" in your account to get OPENSKY_CLIENT_ID / SECRET.
 */
async function getOpenSkyToken(): Promise<string | null> {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const now = Date.now();
  if (tokenCache && tokenCache.exp > now + 30_000) return tokenCache.token;

  const res = await fetch(OPENSKY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`opensky auth failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache = { token: json.access_token, exp: now + (json.expires_in ?? 1800) * 1000 };
  return tokenCache.token;
}

export async function fetchAircraft(
  bbox?: [number, number, number, number],
): Promise<Aircraft[]> {
  let url = "https://opensky-network.org/api/states/all";
  if (bbox) {
    const [w, s, e, n] = bbox;
    url += `?lamin=${s}&lomin=${w}&lamax=${n}&lomax=${e}`;
  }

  const headers: Record<string, string> = {};
  const token = await getOpenSkyToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    // Legacy basic-auth fallback (deprecated by OpenSky).
    const user = process.env.OPENSKY_USERNAME;
    const pass = process.env.OPENSKY_PASSWORD;
    if (user && pass) {
      headers.Authorization = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
    }
  }

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`opensky fetch failed: ${res.status} ${res.statusText}`);
  return parseStates(await res.json());
}
