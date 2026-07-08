/**
 * USGS Volcano Notification Service (VONA) "elevated" feed — currently
 * elevated-status US-monitored volcanoes (Hawaii/HVO, Alaska/AVO, Cascades/CVO,
 * etc.), refreshed by USGS as notices are issued rather than on a weekly cycle.
 * Verified live before writing this: keyless JSON, `vnum` is the SAME
 * Smithsonian VOTW number our `volcanoId` ("gvp:<vnum>") already keys on, so
 * these join directly onto the GVP-bulletin-sourced docs.
 *
 * Unlike the GVP weekly bulletin this is an undocumented endpoint (no public
 * API contract) — treat it as a bonus freshness signal, not a source of truth;
 * callers must degrade gracefully (see worker/src/jobs/volcanoes.ts#snapshotUsgs).
 */
export const USGS_VONA_URL =
  process.env.USGS_VONA_URL || "https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated";

export interface UsgsVonaAlert {
  /** Our stable `gvp:<vnum>` volcanoId — same numbering as the Smithsonian weekly bulletin. */
  volcanoId: string;
  name: string;
  lat: number;
  lng: number;
  alertLevel: string;
  colorCode: string;
  noticeSynopsis?: string;
  noticeUrl?: string;
  updatedAtMs: number;
}

export async function fetchUsgsVonaAlerts(fetchImpl: typeof fetch = fetch): Promise<UsgsVonaAlert[]> {
  const res = await fetchImpl(USGS_VONA_URL);
  if (!res.ok) throw new Error(`usgs vona ${res.status}`);
  const raw: any[] = await res.json();
  const out: UsgsVonaAlert[] = [];
  for (const r of raw) {
    const vnum = String(r?.vnum ?? "").trim();
    const lat = Number(r?.lat);
    const lng = Number(r?.long);
    if (!vnum || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const updatedMs = Date.parse(`${r?.sentUtc ?? ""}Z`.replace(" ", "T"));
    out.push({
      volcanoId: `gvp:${vnum}`,
      name: String(r?.vName ?? "").trim() || vnum,
      lat,
      lng,
      alertLevel: String(r?.alertLevel ?? "").trim(),
      colorCode: String(r?.colorCode ?? "").trim(),
      noticeSynopsis: typeof r?.noticeSynopsis === "string" ? r.noticeSynopsis.trim() : undefined,
      noticeUrl: typeof r?.noticeUrl === "string" ? r.noticeUrl : undefined,
      updatedAtMs: Number.isFinite(updatedMs) ? updatedMs : Date.now(),
    });
  }
  return out;
}
