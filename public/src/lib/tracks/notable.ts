/**
 * Client helpers for the notable-tracks catalog — the long-running, curated list
 * of interesting aircraft/ships, independent of the live feed. Used by the admin
 * aircraft/ship tables to mark + toggle which live craft are catalogued.
 *
 * Pure client module — no mongoose/model import (that would bloat the browser
 * bundle); the catalog key is composed inline, matching the server's vehicleId.
 */
export type NotableKind = "aircraft" | "ship";

export interface NotableEntry {
  id: string;
  kind: NotableKind;
  code: string;
  label: string;
  category?: string;
  photoUrl?: string;
  wikiExtract?: string;
  enabled?: boolean;
  vip?: boolean;
}

/** Catalog key for a live row, matching the server's vehicleId (`${kind}:${code}`). */
export const keyFor = (kind: NotableKind, code: string): string =>
  `${kind}:${String(code).trim().toLowerCase()}`;

/** The whole catalog (for marking which live rows are already notable). */
export async function listNotable(): Promise<NotableEntry[]> {
  try {
    const res = await fetch("/api/admin/notable", { cache: "no-store" });
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j.notable) ? j.notable : [];
  } catch {
    return [];
  }
}

/** Add (or edit) a craft in the catalog + trigger a targeted enrichment. */
export async function addNotable(input: {
  kind: NotableKind;
  code: string;
  label?: string;
  wikiTitle?: string;
  vip?: boolean;
}): Promise<NotableEntry> {
  const res = await fetch("/api/admin/notable", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j.notable;
}

/** Remove a craft from the catalog. */
export async function removeNotable(id: string): Promise<void> {
  await fetch(`/api/admin/notable?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}
