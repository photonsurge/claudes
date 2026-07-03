"use client";

import { useEffect, useState } from "react";
import type { AuroraMeta } from "@photonsurge/shared/aurora/types";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { loadTexture, type LoadedTexture } from "./textures";

/** Poll fallback in case a socket beat is missed; the worker re-bakes ~5 min. */
const POLL_MS = 5 * 60 * 1000;

/** Frame metadata (incl. Kp for the HUD) plus the decoded scalar texture. */
export interface AuroraOverlay {
  meta: AuroraMeta;
  /** Decoded probability texture for the RasterLayer; null until it loads. */
  texture: LoadedTexture | null;
}

/**
 * Load the worker-cached aurora frame for the globe overlay + HUD. Fetches the
 * frame metadata (bounds/timestamps/Kp), then loads the SCALAR probability texture
 * (via WeatherLayers `loadTextureData`, keyed on `updatedAt` so a fresh bake busts
 * the cache). Refetches on the worker's TRACKS_UPDATED (kind "aurora") beat with a
 * slow interval fallback. Returns null when disabled or before the first frame.
 */
export function useAurora(enabled: boolean): AuroraOverlay | null {
  const [meta, setMeta] = useState<AuroraMeta | null>(null);
  const [texture, setTexture] = useState<LoadedTexture | null>(null);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "aurora") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setMeta(null);
      setTexture(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/aurora", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!cancelled && body) setMeta(body.aurora ?? null);
      } catch {
        /* leave previous frame in place on a transient fetch error */
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled, liveTick]);

  // Load the scalar texture whenever the frame changes (URL embeds updatedAt).
  useEffect(() => {
    if (!meta) {
      setTexture(null);
      return;
    }
    let cancelled = false;
    loadTexture(`/api/aurora/frame.png?v=${encodeURIComponent(meta.updatedAt)}`)
      .then((tex) => {
        if (!cancelled) setTexture(tex);
      })
      .catch(() => {
        if (!cancelled) setTexture(null);
      });
    return () => {
      cancelled = true;
    };
  }, [meta?.updatedAt]);

  if (!enabled || !meta) return null;
  return { meta, texture };
}
