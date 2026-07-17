"use client";

/**
 * HTML name labels for the live-track + city overlays. deck's TextLayer renders
 * blank under the _GlobeView build (canvas font atlases come back empty — see the
 * icon/text-atlas note), so labels are drawn as plain DOM positioned over the
 * WebGL canvas instead. Same approach as GlobeAtmosphere: read the live deck
 * viewport each frame and write element transforms imperatively in a rAF, so
 * spin/zoom never re-renders React. Pointer-inert so it never eats globe clicks,
 * and — being part of the page — it's captured by OBS / the YouTube output.
 *
 * Two things are handled per-frame from the LIVE viewport (not React state, which
 * doesn't rebuild on zoom):
 *  - far-side culling — deck's project() happily returns screen coords for points
 *    occluded by the globe, so we cull with a near-hemisphere dot-product test.
 *  - progressive reveal — a label only shows once the live zoom passes its
 *    `minZoom`, and its dim detail line once past `detailMinZoom`; so the globe
 *    view stays clean and detail arrives as you zoom in.
 */
import { useEffect, useMemo, useRef, type ReactNode } from "react";

export interface OverlayLabel {
  id: string;
  text: string;
  /** Small glyph rendered before the text (e.g. a station-type icon). Purely
   *  decorative — not counted by `labelWidth()`'s collision estimate. */
  icon?: ReactNode;
  /** Dim secondary line (e.g. "United Kingdom · 9.0M"), shown when zoomed in. */
  detail?: string;
  /** [lng, lat, altM] — same position the marker/dot uses, so they line up. */
  position: [number, number, number];
  color: [number, number, number];
  /** Hide the whole label below this zoom (progressive reveal). Default 0. */
  minZoom?: number;
  /** Hide just the detail line below this zoom. Default = always show detail. */
  detailMinZoom?: number;
}

// deck's viewport type is awkward to import; we only need project()/width/height/zoom.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Viewport = any;

/** Unit vector on the sphere for a lng/lat (degrees). */
function unit(lng: number, lat: number): [number, number, number] {
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180;
  const cl = Math.cos(la);
  return [cl * Math.cos(lo), cl * Math.sin(lo), Math.sin(la)];
}

// ── Collision avoidance ───────────────────────────────────────────────────
// A dense conurbation (Barcelona's satellite towns, Madrid's suburbs …) can
// reveal a dozen same-tier labels within a few dozen pixels of each other.
// Each frame, labels are placed in priority order (biggest/capital first —
// `minZoom` is already that ranking) into a coarse screen-space grid; a label
// whose estimated box collides with an already-placed one is hidden (its dot,
// drawn by the separate deck.gl scatter layer, stays visible either way — only
// the crowded TEXT thins out, same as any decluttered map).
const LABEL_H = 15;
const CHAR_W = 6.3;
const GRID_CELL = 48;

/** Rough on-screen text width, so collision testing never needs a DOM read. */
export function labelWidth(text: string): number {
  return Math.min(240, 18 + text.length * CHAR_W);
}

export class LabelGrid {
  private cells = new Map<string, Array<[number, number, number, number]>>();

  clear() {
    this.cells.clear();
  }

  private forCells(x0: number, y0: number, x1: number, y1: number, fn: (key: string) => void) {
    const cx0 = Math.floor(x0 / GRID_CELL);
    const cx1 = Math.floor(x1 / GRID_CELL);
    const cy0 = Math.floor(y0 / GRID_CELL);
    const cy1 = Math.floor(y1 / GRID_CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) fn(`${cx},${cy}`);
    }
  }

  /** True if the box overlaps anything already placed. */
  collides(x0: number, y0: number, x1: number, y1: number): boolean {
    let hit = false;
    this.forCells(x0, y0, x1, y1, (key) => {
      if (hit) return;
      const rects = this.cells.get(key);
      if (!rects) return;
      for (const [rx0, ry0, rx1, ry1] of rects) {
        if (x0 < rx1 && x1 > rx0 && y0 < ry1 && y1 > ry0) {
          hit = true;
          break;
        }
      }
    });
    return hit;
  }

  place(x0: number, y0: number, x1: number, y1: number) {
    this.forCells(x0, y0, x1, y1, (key) => {
      let rects = this.cells.get(key);
      if (!rects) {
        rects = [];
        this.cells.set(key, rects);
      }
      rects.push([x0, y0, x1, y1]);
    });
  }
}

export default function GlobeLabels({
  getViewport,
  getCamera,
  labels,
}: {
  /** The live deck viewport (has project()/width/height/zoom), or null if not ready. */
  getViewport: () => Viewport | null;
  /** The sub-camera point, for the near-hemisphere visibility test. */
  getCamera: () => { longitude: number; latitude: number };
  labels: OverlayLabel[];
}) {
  const elRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const detailRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Biggest/capital first (lowest minZoom) so a crowded conurbation always
  // keeps its most important label and thins out the smaller neighbours.
  const priorityLabels = useMemo(
    () => [...labels].sort((a, b) => (a.minZoom ?? 0) - (b.minZoom ?? 0)),
    [labels],
  );
  const priorityRef = useRef<OverlayLabel[]>(priorityLabels);
  priorityRef.current = priorityLabels;
  const gridRef = useRef<LabelGrid>(new LabelGrid());

  // Project + position every frame (camera may be spinning/zooming without new data).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      // deck.gl can throw an internal assertion from getViewport()/project()
      // mid-transition (e.g. between view changes) — an uncaught throw here
      // would skip the reschedule below and permanently freeze every label
      // for the rest of the session, so guard per frame instead.
      try {
        tick();
      } catch {
        /* transient — try again next frame */
      }
      raf = requestAnimationFrame(loop);
    };
    const tick = () => {
      const vp = getViewport();
      if (vp) {
        const cam = getCamera();
        const [cx, cy, cz] = unit(cam.longitude, cam.latitude);
        const w = vp.width;
        const h = vp.height;
        const zoom = vp.zoom ?? 0;
        const grid = gridRef.current;
        grid.clear();
        for (const l of priorityRef.current) {
          const el = elRefs.current.get(l.id);
          if (!el) continue;
          // Progressive reveal: below the label's minZoom it's not shown at all.
          if (zoom < (l.minZoom ?? 0)) {
            el.style.opacity = "0";
            continue;
          }
          const [ux, uy, uz] = unit(l.position[0], l.position[1]);
          // Dot < 0 → the point is on the hidden hemisphere; small margin so
          // labels don't flicker right at the limb.
          if (ux * cx + uy * cy + uz * cz <= 0.04) {
            el.style.opacity = "0";
            continue;
          }
          const p = vp.project(l.position);
          const x = p[0];
          const y = p[1];
          if (x < -160 || y < -50 || x > w + 160 || y > h + 50) {
            el.style.opacity = "0";
            continue;
          }
          // Decluttering: skip (hide) this label if a higher-priority one
          // already claimed overlapping screen space this frame. Box is
          // anchored the same way the CSS lays the text out — right of the
          // point, vertically centred.
          const x0 = x;
          const y0 = y - LABEL_H / 2;
          const x1 = x + labelWidth(l.text);
          const y1 = y0 + LABEL_H;
          if (grid.collides(x0, y0, x1, y1)) {
            el.style.opacity = "0";
            continue;
          }
          grid.place(x0, y0, x1, y1);
          el.style.opacity = "1";
          el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
          const detail = detailRefs.current.get(l.id);
          if (detail) {
            detail.style.display = zoom >= (l.detailMinZoom ?? 0) ? "block" : "none";
          }
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getViewport, getCamera]);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 2 }}>
      {labels.map((l) => (
        <div
          key={l.id}
          ref={(el) => {
            if (el) elRefs.current.set(l.id, el);
            else elRefs.current.delete(l.id);
          }}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            opacity: 0,
            willChange: "transform",
            transform: "translate(-9999px, -9999px)",
            // Nudge the text to the right of the dot and vertically centre it on
            // the projected point.
            paddingLeft: 9,
            marginTop: "-0.5em",
            whiteSpace: "nowrap",
            fontFamily: "system-ui, sans-serif",
            lineHeight: 1.1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              fontSize: 12,
              fontWeight: 600,
              color: `rgb(${l.color[0]}, ${l.color[1]}, ${l.color[2]})`,
              textShadow: "0 0 3px #000, 0 0 3px #000, 0 1px 2px #000",
            }}
          >
            {l.icon}
            {l.text}
          </div>
          {l.detail ? (
            <div
              ref={(el) => {
                if (el) detailRefs.current.set(l.id, el);
                else detailRefs.current.delete(l.id);
              }}
              // Backing chip: the detail line ("Country · 1.5M · capital") is
              // small and sits straight on the basemap — a text shadow alone
              // isn't enough over light terrain, especially after stream
              // compression.
              style={{
                display: "none",
                width: "fit-content",
                marginTop: 2,
                padding: "1px 6px",
                borderRadius: 4,
                background: "rgba(2,8,18,0.62)",
                fontSize: 10,
                fontWeight: 500,
                color: "rgba(226,232,240,0.92)",
                textShadow: "0 1px 2px #000",
              }}
            >
              {l.detail}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
