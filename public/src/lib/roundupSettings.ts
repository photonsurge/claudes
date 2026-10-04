/**
 * Client helpers for the round-up schedule card. Fetch /api/admin/roundup-settings;
 * the shapes come from the shared model so the card and the worker agree.
 */
import type { RoundupId, RoundupSettings } from "@photonsurge/shared/roundup-settings";

export interface RoundupSettingsResponse {
  settings: RoundupSettings;
  /** Latest `generatedAt` (ISO) per GLOBAL round-up; place ids are omitted. */
  lastRun: Partial<Record<RoundupId, string | null>>;
}

export async function getRoundupSettings(): Promise<RoundupSettingsResponse> {
  const res = await fetch("/api/admin/roundup-settings", { cache: "no-store" });
  if (!res.ok) throw new Error(`round-up settings fetch failed: ${res.status}`);
  return res.json();
}

/** Save a subset of rows; the route overlays them on what is stored. Returns the stored settings. */
export async function saveRoundupSettings(settings: Partial<RoundupSettings>): Promise<RoundupSettings> {
  const res = await fetch("/api/admin/roundup-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? `save failed: ${res.status}`);
  return body.settings;
}
