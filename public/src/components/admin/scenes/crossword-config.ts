/**
 * Client reads and writes of a crossword channel's config
 * (/api/crossword/:scene/config), for the settings page's Game cards. Shaped
 * like `fetchDirectorConfig` / `patchDirectorConfig`: the read normalises
 * against the defaults and never throws; the write THROWS on a rejected save so
 * the Save bar can report it.
 */
import {
  DEFAULT_CROSSWORD_CONFIG,
  mergeCrosswordConfig,
  type CrosswordConfig,
} from "@photonsurge/shared/crossword";

const configUrl = (sceneId: string) => `/api/crossword/${encodeURIComponent(sceneId)}/config`;

export async function fetchCrosswordConfig(sceneId: string): Promise<CrosswordConfig> {
  try {
    const res = await fetch(configUrl(sceneId), { cache: "no-store" });
    if (!res.ok) return DEFAULT_CROSSWORD_CONFIG;
    return mergeCrosswordConfig(DEFAULT_CROSSWORD_CONFIG, await res.json());
  } catch {
    return DEFAULT_CROSSWORD_CONFIG;
  }
}

export async function patchCrosswordConfig(
  sceneId: string,
  patch: Partial<CrosswordConfig>,
): Promise<CrosswordConfig> {
  const res = await fetch(configUrl(sceneId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `crossword config write failed (${res.status})`);
  }
  return (await res.json()) as CrosswordConfig;
}
