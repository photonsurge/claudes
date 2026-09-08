"use client";

import { useEffect, useMemo, useState } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { loadTexture } from "./textures";

/**
 * Fail-safe: never leave the broadcast behind the cold-start cover longer than
 * this, whatever the network does. The cover exists so a director cut never
 * hits a cold texture fetch — a black stream is far worse than that.
 */
export const READY_TIMEOUT_MS = 45_000;

/** Every variable's texture URL at `fhr`, in manifest order. */
export function textureUrlsAt(manifest: WeatherManifest, fhr: number): string[] {
  return Object.values(manifest.variables)
    .map((v) => v.files[String(fhr)])
    .filter((u): u is string => !!u);
}

/**
 * Latches `true` the first time every variable's texture at the current fhr
 * has decoded (the same set Globe's "keep every map in RAM" effect warms —
 * see Globe.tsx's preloadTextures call). Used to gate the /watch loading
 * screen: once true, a director cut or map-type switch never hits a cold
 * network fetch. Never re-arms after that — a later fhr/manifest change (the
 * timeline advancing, a new model run landing) must not drop the globe back
 * behind a spinner mid-broadcast.
 *
 * Two things this must never do (both seen on air, 2026-09-08 — a scene sat
 * behind the cover for 10+ minutes with the globe drawing underneath):
 * - restart the wait because the manifest OBJECT was refetched with the same
 *   files, or because fhr / a bake stamp moved on before a set finished. The
 *   old effect cancelled the previous load's latch on every re-run, so inputs
 *   that changed faster than a full texture set loads meant it never latched.
 *   Now the URL SET is the input, and any set that finishes counts.
 * - wait forever: READY_TIMEOUT_MS latches regardless (and textures.ts caps a
 *   single hung fetch too).
 */
export function useGlobeReadyOnce(manifest: WeatherManifest | null, fhr: number): boolean {
  const [ready, setReady] = useState(false);
  const urlKey = useMemo(() => (manifest ? textureUrlsAt(manifest, fhr).join("\n") : ""), [manifest, fhr]);

  useEffect(() => {
    if (ready || !urlKey) return;
    const urls = urlKey.split("\n");
    // Deliberately not cancelled on re-run: see above.
    Promise.all(urls.map((u) => loadTexture(u).catch(() => undefined))).then(() => setReady(true));
  }, [urlKey, ready]);

  const hasManifest = !!manifest;
  useEffect(() => {
    if (ready || !hasManifest) return;
    const t = setTimeout(() => setReady(true), READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready, hasManifest]);

  return ready;
}
