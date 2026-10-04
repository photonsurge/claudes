/**
 * The viewer-pick layer on /watch (shared/viewer.ts): what viewers chose from
 * chat — a music mode, a palette — composed OVER the operator's settings for
 * as long as each pick holds. Nothing here writes operator state; when a pick
 * lapses the channel's own look is simply back.
 */
import { useEffect, useMemo, useState } from "react";
import type { ControlState } from "@photonsurge/shared/control";
import { channelPalettes } from "@photonsurge/shared/chat-policy";
import {
  VIEWER_STATE,
  activePicks,
  nextViewerExpiry,
  type ViewerRequest,
  type ViewerSlot,
  type ViewerState,
} from "@photonsurge/shared/viewer";
import { useSocket } from "./socket-provider";

export type ViewerPicks = Partial<Record<ViewerSlot, ViewerRequest>>;

/** Cold-start read; null on any failure (the socket fills it in). */
export async function fetchViewerState(sceneId: string, token?: string): Promise<ViewerState | null> {
  try {
    const q = token ? `?token=${encodeURIComponent(token)}` : "";
    const res = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/viewer${q}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as ViewerState) : null;
  } catch {
    return null;
  }
}

/** The scene's viewer state: fetched once, then live over the socket. */
export function useViewerState(sceneId: string, token?: string): ViewerState | null {
  const { socket } = useSocket();
  const [state, setState] = useState<ViewerState | null>(null);

  useEffect(() => {
    let live = true;
    setState(null);
    void fetchViewerState(sceneId, token).then((s) => {
      // A socket update may already have landed; never go backwards.
      if (live && s) setState((prev) => (prev && prev.updatedAt > s.updatedAt ? prev : s));
    });
    return () => {
      live = false;
    };
  }, [sceneId, token]);

  useEffect(() => {
    if (!socket) return;
    const on = (payload: { data?: ViewerState } & Partial<ViewerState>) => {
      const s = (payload?.data ?? payload) as ViewerState;
      if (s?.sceneId === sceneId) setState(s);
    };
    socket.on(VIEWER_STATE, on);
    return () => {
      socket.off(VIEWER_STATE, on);
    };
  }, [socket, sceneId]);

  return state;
}

/** The picks in force now, re-evaluated at the earliest expiry (one timeout). */
export function useViewerPicks(state: ViewerState | null): ViewerPicks {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const next = nextViewerExpiry(state, Date.now());
    if (next == null) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 16);
    return () => clearTimeout(t);
  }, [state, now]);
  return useMemo(() => activePicks(state, now), [state, now]);
}

/**
 * Pure: the channel's state with the viewer picks on top — the music mode for
 * the bed, and a palette from the channel's own list (or the built-ins). An
 * unknown palette id is ignored.
 */
export function composeViewerLayer(state: ControlState, picks: ViewerPicks): ControlState {
  let out = state;
  const music = picks.audioMode;
  if (music) out = { ...out, audio: { ...out.audio, mode: music.value as ControlState["audio"]["mode"] } };
  const theme = picks.theme;
  if (theme) {
    const palette = channelPalettes(state.chat.commands).find((p) => p.id === theme.value);
    if (palette) out = { ...out, broadcastTheme: palette.broadcastTheme, themeOverrides: { ...(palette.themeOverrides ?? {}) } };
  }
  return out;
}
