import type { Ad, AdStatus } from "./types";

export interface AdsResponse {
  count: number;
  ads: Ad[];
  error?: string;
}

export interface AdListOpts {
  status?: AdStatus;
  q?: string;
}

/** URL for an ad's stored media, cache-busted on the last edit. */
export function adMediaUrl(ad: Ad): string {
  const v = ad.updatedAt ?? ad.createdAt ?? 0;
  return `/api/ads/${encodeURIComponent(ad.adId)}/media?v=${v}`;
}

/** List ads from the admin API (metadata only). No limit (show all). */
export async function listAds(opts: AdListOpts = {}): Promise<AdsResponse> {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  if (opts.q) params.set("q", opts.q);
  const qs = params.toString();
  const res = await fetch(`/api/admin/ads${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) return { count: 0, ads: [], error: body?.error ?? `HTTP ${res.status}` };
  return body as AdsResponse;
}

/** Create one ad from a multipart form (`file` + metadata fields). */
export async function createAd(form: FormData): Promise<{ ad?: Ad; error?: string }> {
  // No explicit Content-Type — the browser sets the multipart boundary.
  const res = await fetch("/api/admin/ads", { method: "POST", body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ad) return { error: body?.error ?? `HTTP ${res.status}` };
  return { ad: body.ad as Ad };
}

/** Edit an ad's metadata (partial patch). */
export async function updateAd(
  adId: string,
  patch: Record<string, unknown>,
): Promise<{ ad?: Ad; error?: string }> {
  const res = await fetch(`/api/admin/ads/${encodeURIComponent(adId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ad) return { error: body?.error ?? `HTTP ${res.status}` };
  return { ad: body.ad as Ad };
}

/** Toggle/set an ad's status. */
export async function setAdStatus(
  adId: string,
  status: AdStatus,
): Promise<{ ad?: Ad; error?: string }> {
  return updateAd(adId, { status });
}

/** Replace an ad's media bytes, keeping its id + metadata. */
export async function replaceAdMedia(
  adId: string,
  file: File,
): Promise<{ ad?: Ad; error?: string }> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(`/api/admin/ads/${encodeURIComponent(adId)}`, {
    method: "PUT",
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ad) return { error: body?.error ?? `HTTP ${res.status}` };
  return { ad: body.ad as Ad };
}

/** Delete an ad by id. */
export async function deleteAd(adId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/admin/ads/${encodeURIComponent(adId)}`, { method: "DELETE" });
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
  return { ok: true };
}

/** Per-ad exposure rollup across the always-on surfaces (see /admin/ads). */
export interface AdExposureTotal {
  /** Cumulative on-air ms: crawl mention + billboard rotation, summed. */
  ms: number;
  /** Scenes it is airing on right now (empty = not currently on air). */
  liveScenes: { id: string; name: string }[];
}

/** One exposure window (no `endedAt` = on air right now). */
export interface AdExposureWindow {
  sceneId: string;
  sceneName: string;
  /** Which always-on surface the window aired on. */
  surface: "ticker" | "billboard" | "alertSlot";
  startedAt: number;
  endedAt?: number;
  ms: number;
}

/** Cumulative exposure time + live-now scenes for every ad, keyed by adId. */
export async function getAdExposureTotals(): Promise<Record<string, AdExposureTotal>> {
  const res = await fetch("/api/admin/ads/exposure", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.totals) return {};
  return body.totals as Record<string, AdExposureTotal>;
}

/** One ad's full exposure log (all surfaces), newest first. */
export async function getAdExposure(adId: string): Promise<AdExposureWindow[]> {
  const res = await fetch(`/api/admin/ads/${encodeURIComponent(adId)}/exposure`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body?.windows)) return [];
  return body.windows as AdExposureWindow[];
}
