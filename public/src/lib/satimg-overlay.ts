"use client";

import { useEffect, useState } from "react";
import type { SatImgMeta } from "@photonsurge/shared/satimg/types";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";

/** Poll fallback in case a socket beat is missed; the worker re-bakes ~10 min. */
const POLL_MS = 10 * 60 * 1000;

/** The set of currently-baked satellite frames (one per bird). */
export interface SatImgOverlay {
  frames: SatImgMeta[];
}

/**
 * Load the worker-cached satellite-imagery frames for the globe overlay. Fetches
 * every baked bird's metadata (bounds/timestamps/composite); the BitmapLayer loads
 * each PNG straight from /api/satimg/frame.png (deck.gl handles the image load, so —
 * unlike aurora's scalar texture — there's no client-side decode here). Refetches on
 * the worker's TRACKS_UPDATED (kind "satimg") beat with a slow interval fallback.
 * Returns null when disabled or before the first frame.
 */
export function useSatImg(enabled: boolean): SatImgOverlay | null {
  const [frames, setFrames] = useState<SatImgMeta[]>([]);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "satimg") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setFrames([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/satimg", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!cancelled && body) setFrames(Array.isArray(body.frames) ? body.frames : []);
      } catch {
        /* leave previous frames in place on a transient fetch error */
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled, liveTick]);

  if (!enabled || !frames.length) return null;
  return { frames };
}
