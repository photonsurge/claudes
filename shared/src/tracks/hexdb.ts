/**
 * hexdb.io aircraft lookup — ICAO24 hex → registration / type / operator.
 * Keyless (no auth), community-maintained. One airframe per call, so callers
 * MUST cache results (see aircraft-meta-model) and rate-limit; the data is
 * effectively static. Network is injectable for tests.
 */

export interface AircraftMetaFields {
  registration?: string;
  /** Full type name, e.g. "Boeing 737-800". */
  type?: string;
  /** ICAO type code, e.g. "B738". */
  typeCode?: string;
  manufacturer?: string;
  operator?: string;
}

const HEXDB_URL = "https://hexdb.io/api/v1/aircraft/";

const clean = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
};

/**
 * Look up one aircraft's metadata. Returns null on bad hex, network error, a
 * non-OK response, or an empty record (so the caller can mark it not-found).
 */
export async function fetchAircraftMeta(
  icao24: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AircraftMetaFields | null> {
  const hex = (icao24 ?? "").trim().toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(hex)) return null;

  let res: Response;
  try {
    res = await fetchImpl(`${HEXDB_URL}${hex}`, { headers: { Accept: "application/json" } });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (await res.json().catch(() => null)) as any;
  if (!j || typeof j !== "object") return null;

  const fields: AircraftMetaFields = {
    registration: clean(j.Registration),
    type: clean(j.Type),
    typeCode: clean(j.ICAOTypeCode),
    manufacturer: clean(j.Manufacturer),
    operator: clean(j.RegisteredOwners),
  };
  // Require at least a registration or type, else treat as no record.
  if (!fields.registration && !fields.type) return null;
  return fields;
}
