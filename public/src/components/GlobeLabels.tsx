"use client";

/**
 * Name labels for the live-track + city overlays, drawn on ONE 2D canvas laid
 * over the WebGL globe. deck's TextLayer renders blank under the _GlobeView
 * build (its GPU font atlases come back empty — see the icon/text-atlas note),
 * and the previous DOM version — one absolutely-positioned div per label with
 * `will-change: transform` — cost the /watch main thread a compositor layer per
 * label (~1.5 k when zoomed into a region), a style recalc over all of them
 * every frame, and a React re-diff of every div each time the track list
 * ticked. A canvas overlay is a handful of `fillText` calls per visible label
 * and no DOM at all. Being part of the page, it's captured by OBS / the
 * YouTube output exactly like the DOM was.
 *
 * Labels with an `icon` (station/volcano/monitor pins — a few dozen at most)
 * stay as DOM so the React icon glyphs render, positioned write-on-change and
 * hidden via `visibility` so a culled pin costs nothing.
 *
 * Per-frame, from the LIVE viewport (not React state, which doesn't rebuild on
 * zoom): far-side culling (deck's project() happily returns screen coords for
 * points occluded by the globe, so we cull with a near-hemisphere dot-product
 * test), progressive reveal by `minZoom` / `detailMinZoom`, and collision
 * decluttering in priority order.
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

// ── Canvas text ───────────────────────────────────────────────────────────
/** Matches the old DOM styling: 12px/600 name, 10px/500 detail chip. */
const NAME_FONT = "600 12px system-ui, sans-serif";
const DETAIL_FONT = "500 10px system-ui, sans-serif";
/** Text starts right of the marker dot, like the DOM's paddingLeft. */
const TEXT_DX = 9;
/** Dark halo standing in for the DOM's stacked text-shadows. */
const HALO = "rgba(0,0,0,0.85)";
const DETAIL_BG = "rgba(2,8,18,0.62)";
const DETAIL_FG = "rgba(226,232,240,0.92)";
const DETAIL_H = 14;
const DETAIL_PAD = 6;
/** Backing-store cap: 2× is crisp on any broadcast canvas; more is wasted fill. */
const MAX_DPR = 2;

/** Detail-line widths, measured once per distinct string (the font is fixed). */
const detailWidths = new Map<string, number>();

function drawDetail(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  let tw = detailWidths.get(text);
  if (tw === undefined) {
    ctx.font = DETAIL_FONT;
    tw = ctx.measureText(text).width;
    detailWidths.set(text, tw);
  }
  const bw = tw + DETAIL_PAD * 2;
  ctx.fillStyle = DETAIL_BG;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, bw, DETAIL_H, 4);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, bw, DETAIL_H);
  }
  ctx.font = DETAIL_FONT;
  ctx.fillStyle = DETAIL_FG;
  ctx.fillText(text, x + DETAIL_PAD, y + DETAIL_H / 2);
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // DOM-rendered icon labels: element + detail element by id, and the last
  // placement written to each so a steady pin writes nothing.
  const elRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const detailRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastPlacedRef = useRef<Map<string, string>>(new Map());
  // Biggest/capital first (lowest minZoom) so a crowded conurbation always
  // keeps its most important label and thins out the smaller neighbours.
  const priorityLabels = useMemo(
    () => [...labels].sort((a, b) => (a.minZoom ?? 0) - (b.minZoom ?? 0)),
    [labels],
  );
  const priorityRef = useRef<OverlayLabel[]>(priorityLabels);
  priorityRef.current = priorityLabels;
  const iconLabels = useMemo(() => labels.filter((l) => l.icon), [labels]);
  const gridRef = useRef<LabelGrid>(new LabelGrid());

  // Project + draw every frame (camera may be spinning/zooming without new data).
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
    const hideDom = (id: string, el: HTMLDivElement) => {
      if (lastPlacedRef.current.get(id) === "hidden") return;
      lastPlacedRef.current.set(id, "hidden");
      el.style.visibility = "hidden";
    };
    const tick = () => {
      const vp = getViewport();
      const canvas = canvasRef.current;
      if (!vp || !canvas) return;
      const w: number = vp.width;
      const h: number = vp.height;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = HALO;
      ctx.font = NAME_FONT;
      let font = NAME_FONT;

      const cam = getCamera();
      const [cx, cy, cz] = unit(cam.longitude, cam.latitude);
      const zoom: number = vp.zoom ?? 0;
      const grid = gridRef.current;
      grid.clear();
      for (const l of priorityRef.current) {
        const el = l.icon ? elRefs.current.get(l.id) : undefined;
        // Progressive reveal: below the label's minZoom it's not shown at all.
        if (zoom < (l.minZoom ?? 0)) {
          if (el) hideDom(l.id, el);
          continue;
        }
        const [ux, uy, uz] = unit(l.position[0], l.position[1]);
        // Dot < 0 → the point is on the hidden hemisphere; small margin so
        // labels don't flicker right at the limb.
        if (ux * cx + uy * cy + uz * cz <= 0.04) {
          if (el) hideDom(l.id, el);
          continue;
        }
        const p = vp.project(l.position);
        const x: number = p[0];
        const y: number = p[1];
        if (x < -160 || y < -50 || x > w + 160 || y > h + 50) {
          if (el) hideDom(l.id, el);
          continue;
        }
        // Decluttering: skip (hide) this label if a higher-priority one
        // already claimed overlapping screen space this frame. Box is
        // anchored the same way the text is laid out — right of the point,
        // vertically centred.
        const x0 = x;
        const y0 = y - LABEL_H / 2;
        const x1 = x + labelWidth(l.text);
        const y1 = y0 + LABEL_H;
        if (grid.collides(x0, y0, x1, y1)) {
          if (el) hideDom(l.id, el);
          continue;
        }
        grid.place(x0, y0, x1, y1);
        const showDetail = !!l.detail && zoom >= (l.detailMinZoom ?? 0);

        if (l.icon) {
          // DOM pin: write only when its placement changed since last frame.
          if (!el) continue;
          const key = `${x.toFixed(1)},${y.toFixed(1)},${showDetail ? 1 : 0}`;
          if (lastPlacedRef.current.get(l.id) === key) continue;
          lastPlacedRef.current.set(l.id, key);
          el.style.visibility = "visible";
          el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
          const detail = detailRefs.current.get(l.id);
          if (detail) detail.style.display = showDetail ? "block" : "none";
          continue;
        }

        // Canvas text: halo stroke, then the coloured name.
        if (font !== NAME_FONT) {
          ctx.font = NAME_FONT;
          font = NAME_FONT;
        }
        const tx = x + TEXT_DX;
        ctx.strokeText(l.text, tx, y);
        ctx.fillStyle = `rgb(${l.color[0]},${l.color[1]},${l.color[2]})`;
        ctx.fillText(l.text, tx, y);
        if (showDetail && l.detail) {
          // Backing chip: the detail line ("Country · 1.5M · capital") is
          // small and sits straight on the basemap — a halo alone isn't enough
          // over light terrain, especially after stream compression.
          drawDetail(ctx, l.detail, tx, y + LABEL_H / 2 + 2);
          font = DETAIL_FONT;
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getViewport, getCamera]);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 2 }}>
      <canvas ref={canvasRef} style={{ position: "absolute", left: 0, top: 0 }} />
      {iconLabels.map((l) => (
        <div
          key={l.id}
          ref={(el) => {
            if (el) elRefs.current.set(l.id, el);
            else {
              elRefs.current.delete(l.id);
              lastPlacedRef.current.delete(l.id);
            }
          }}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            visibility: "hidden",
            transform: "translate(-9999px, -9999px)",
            // Nudge the text to the right of the dot and vertically centre it on
            // the projected point.
            paddingLeft: TEXT_DX,
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
              style={{
                display: "none",
                width: "fit-content",
                marginTop: 2,
                padding: "1px 6px",
                borderRadius: 4,
                background: DETAIL_BG,
                fontSize: 10,
                fontWeight: 500,
                color: DETAIL_FG,
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
