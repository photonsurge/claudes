import type { Cam, CamStatus } from "./types";

export interface CamsResponse {
  count: number;
  cams: Cam[];
  error?: string;
}

export interface CamListOpts {
  status?: CamStatus;
  bbox?: [number, number, number, number];
  q?: string;
}

/** List catalogued webcams from the admin API. No limit (show all). */
export async function listCams(opts: CamListOpts = {}): Promise<CamsResponse> {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  if (opts.bbox) params.set("bbox", opts.bbox.join(","));
  if (opts.q) params.set("q", opts.q);
  const qs = params.toString();
  const res = await fetch(`/api/admin/cams${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) return { count: 0, cams: [], error: body?.error ?? `HTTP ${res.status}` };
  return body as CamsResponse;
}

/** Create or edit one cam (upsert on camId). Returns the saved cam or an error. */
export async function saveCam(
  input: Record<string, unknown>,
): Promise<{ cam?: Cam; error?: string }> {
  const res = await fetch("/api/admin/cams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.cam) return { error: body?.error ?? `HTTP ${res.status}` };
  return { cam: body.cam as Cam };
}

/** Patch a cam's status. */
export async function setCamStatus(
  camId: string,
  status: CamStatus,
): Promise<{ cam?: Cam; error?: string }> {
  const res = await fetch(`/api/admin/cams/${encodeURIComponent(camId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.cam) return { error: body?.error ?? `HTTP ${res.status}` };
  return { cam: body.cam as Cam };
}

/** Delete a cam by provider id. */
export async function deleteCam(camId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/admin/cams/${encodeURIComponent(camId)}`, { method: "DELETE" });
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
  return { ok: true };
}
