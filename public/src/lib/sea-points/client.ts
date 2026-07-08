import type { SeaPoint } from "./types";

export interface SeaPointsResponse {
  count: number;
  seaPoints: SeaPoint[];
  error?: string;
}

/** List the full sea-point catalog (admin sees disabled points too). */
export async function listSeaPoints(): Promise<SeaPointsResponse> {
  const res = await fetch("/api/admin/sea-points", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) return { count: 0, seaPoints: [], error: body?.error ?? `HTTP ${res.status}` };
  return body as SeaPointsResponse;
}

/** Create or edit one sea point (upsert on pointId). */
export async function saveSeaPoint(
  input: Record<string, unknown>,
): Promise<{ seaPoint?: SeaPoint; error?: string }> {
  const res = await fetch("/api/admin/sea-points", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.seaPoint) return { error: body?.error ?? `HTTP ${res.status}` };
  return { seaPoint: body.seaPoint as SeaPoint };
}

/** Toggle whether the Director offers this point as a candidate. */
export async function setSeaPointEnabled(
  pointId: string,
  enabled: boolean,
): Promise<{ seaPoint?: SeaPoint; error?: string }> {
  const res = await fetch(`/api/admin/sea-points/${encodeURIComponent(pointId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.seaPoint) return { error: body?.error ?? `HTTP ${res.status}` };
  return { seaPoint: body.seaPoint as SeaPoint };
}

/** Delete a sea point by pointId. */
export async function deleteSeaPoint(pointId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/admin/sea-points/${encodeURIComponent(pointId)}`, { method: "DELETE" });
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
  return { ok: true };
}
