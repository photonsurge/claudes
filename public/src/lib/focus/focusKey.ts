/**
 * Canonical focus key. The bundle is a pure function of (kind, rounded lng/lat,
 * zoom, detail, subject), so the key must be identical everywhere it's built
 * (route, provider, and — later — the worker pre-warm). Rounding to a grid means
 * idle spin / sub-pixel camera drift reuses the same cached entry, while distinct
 * scenes stay distinct.
 */
import type { FocusRequest } from "./types";

/** Round to `dp` decimal places, normalising -0 to 0 so keys never differ on sign. */
function round(n: number, dp: number): number {
  const f = 10 ** dp;
  const r = Math.round(n * f) / f;
  return r === 0 ? 0 : r;
}

export interface NormalizedFocus {
  kind: FocusRequest["kind"];
  detail: FocusRequest["detail"];
  subject: string | null;
  /** [lng, lat] rounded to 2dp */
  center: [number, number];
  /** rounded to 1dp */
  zoom: number;
}

/** Snap a request onto the canonical grid: lng/lat → 2dp, zoom → 1dp. */
export function normalizeFocus(req: FocusRequest): NormalizedFocus {
  return {
    kind: req.kind,
    detail: req.detail,
    subject: req.subject ?? null,
    center: [round(req.center[0], 2), round(req.center[1], 2)],
    zoom: round(req.zoom, 1),
  };
}

/** The Redis / HTTP cache key. Namespaced `focus:v1:` so the whole cache can be
 *  busted by bumping the version when the bundle shape changes. */
export function buildFocusKey(req: FocusRequest): string {
  const n = normalizeFocus(req);
  return [
    "focus",
    "v1",
    n.detail,
    n.kind,
    n.subject ?? "-",
    n.center[0],
    n.center[1],
    n.zoom,
  ].join(":");
}
