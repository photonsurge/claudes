/**
 * Client reads and writes for a crossword channel's settings page: the game
 * config (/api/crossword/:scene/config) and the connected YouTube channels
 * (/api/youtube). The config read normalises against the defaults and never
 * throws; the write THROWS on a rejected save so the Save bar can report it.
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

/** A connected YouTube channel; `needsReconnect` when Google rejected its token. */
export interface YoutubeChannel {
  id: string;
  title: string;
  needsReconnect: boolean;
}

/** The connected YouTube channels (as /admin/youtube lists them); [] on failure. */
export async function fetchYoutubeChannels(): Promise<YoutubeChannel[]> {
  try {
    const res = await fetch("/api/youtube", { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    const list = Array.isArray(json?.accounts) ? json.accounts : [];
    return list.map((a: { channelId: string; channelTitle?: string | null; authError?: unknown }) => ({
      id: a.channelId,
      title: a.channelTitle || a.channelId,
      needsReconnect: !!a.authError,
    }));
  } catch {
    return [];
  }
}
