"use client";

import { useEffect, useState } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { loadTexture } from "./textures";

/**
 * Latches `true` the first time every variable's texture at the current fhr
 * has decoded (the same set Globe's "keep every map in RAM" effect warms —
 * see Globe.tsx's preloadTextures call). Used to gate the /watch loading
 * screen: once true, a director cut or map-type switch never hits a cold
 * network fetch. Never re-arms after that — a later fhr/manifest change (the
 * timeline advancing, a new model run landing) must not drop the globe back
 * behind a spinner mid-broadcast.
 */
export function useGlobeReadyOnce(manifest: WeatherManifest | null, fhr: number): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready || !manifest) return;
    let cancelled = false;
    const urls = Object.values(manifest.variables)
      .map((v) => v.files[String(fhr)])
      .filter((u): u is string => !!u);
    Promise.all(urls.map((u) => loadTexture(u).catch(() => undefined))).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [manifest, fhr, ready]);

  return ready;
}
