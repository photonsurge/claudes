/**
 * OBS/CEF render mode for the /watch surface. Each OBS browser source is a full
 * embedded Chromium rendering the whole page, so a multi-stream rig pays for
 * every pixel N times — when we detect we're inside one, the surface drops the
 * purely-cosmetic costs (backdrop blurs, DPR upscaling) and asks for the
 * discrete GPU, while the provisioner caps the source's paint rate at the
 * stream's real fps (worker/src/obs/client.ts).
 *
 * Also the home of the WebGL renderer telemetry: Globe reports the device that
 * actually initialised, and RenderHealthBadge surfaces a software-rasteriser
 * fallback (llvmpipe/SwiftShader) as a red chip the operator can see straight
 * in the OBS preview — the honest answer to "is Chromium really on the GPU?".
 */
import { useSyncExternalStore } from "react";

/** Minimal window shape for detection — injectable for tests. */
export interface ObsWindowLike {
  obsstudio?: unknown;
  location?: { search?: string };
}

/** Pure detection: OBS injects `window.obsstudio` into every browser source
 *  before page scripts run; `?obs=1` forces the mode in a normal browser. */
export function detectObsRender(win: ObsWindowLike | undefined | null): boolean {
  if (!win) return false;
  if (win.obsstudio) return true;
  return /[?&]obs=1(?:&|$)/.test(win.location?.search ?? "");
}

/** True when this page is being rendered inside an OBS browser source. */
export function isObsRender(): boolean {
  if (typeof window === "undefined") return false;
  return detectObsRender(window as unknown as ObsWindowLike);
}

/** A renderer string that means WebGL fell back to CPU rasterisation. */
export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
}

export interface RendererInfo {
  vendor: string;
  renderer: string;
  software: boolean;
}

let rendererInfo: RendererInfo | null = null;
const subscribers = new Set<() => void>();

/** Called once by Globe when deck.gl's GPU device comes up. */
export function setRendererInfo(vendor: string, renderer: string): void {
  rendererInfo = { vendor, renderer, software: isSoftwareRenderer(renderer) };
  for (const fn of subscribers) fn();
}

export function getRendererInfo(): RendererInfo | null {
  return rendererInfo;
}

/** The reported GPU device, or null until the globe has initialised WebGL. */
export function useRendererInfo(): RendererInfo | null {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    getRendererInfo,
    () => null,
  );
}
