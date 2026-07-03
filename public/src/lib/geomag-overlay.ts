"use client";

import { useEffect, useState } from "react";
import type { GeomagMeta } from "@photonsurge/shared/geomag/types";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { loadTexture, type LoadedTexture } from "./textures";

/** Frame metadata plus the decoded scalar total-intensity texture. */
export interface GeomagOverlay {
  meta: GeomagMeta;
  texture: LoadedTexture | null;
}

/**
 * Load the worker-cached geomagnetic-field frame for the globe overlay. The field
 * is near-static, so there's no polling — fetch once when enabled and refetch only
 * when the worker emits TRACKS_UPDATED (kind "geomag") after a re-bake. Returns null
 * when disabled or before the first bake.
 */
export function useGeomag(enabled: boolean): GeomagOverlay | null {
  const [meta, setMeta] = useState<GeomagMeta | null>(null);
  const [texture, setTexture] = useState<LoadedTexture | null>(null);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "geomag") setLiveTick((n) => n + 1);
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
    (async () => {
      try {
        const res = await fetch("/api/geomag", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!cancelled && body) setMeta(body.geomag ?? null);
      } catch {
        /* leave previous frame in place on a transient fetch error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, liveTick]);

  useEffect(() => {
    if (!meta) {
      setTexture(null);
      return;
    }
    let cancelled = false;
    loadTexture(`/api/geomag/frame.png?v=${encodeURIComponent(meta.updatedAt)}`)
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
