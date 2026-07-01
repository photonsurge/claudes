"use client";

/**
 * HTML name labels for the live-track overlay. deck's TextLayer renders blank
 * under the _GlobeView build (canvas font atlases come back empty — see the
 * icon/text-atlas note), so track names are drawn as plain DOM positioned over
 * the WebGL canvas instead. Same approach as GlobeAtmosphere: read the live deck
 * viewport each frame and write element transforms imperatively in a rAF, so
 * spin/zoom never re-renders React. Pointer-inert so it never eats globe clicks,
 * and — being part of the page — it's captured by OBS / the YouTube output.
 *
 * Labels on the FAR side of the globe are hidden (deck's project() happily
 * returns screen coords for occluded points, so we cull with a near-hemisphere
 * dot-product test against the sub-camera point).
 */
import { useEffect, useRef } from "react";
import type { TrackLabel } from "./layers/tracks";

// deck's viewport type is awkward to import; we only need project()+width/height.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Viewport = any;

/** Unit vector on the sphere for a lng/lat (degrees). */
function unit(lng: number, lat: number): [number, number, number] {
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180;
  const cl = Math.cos(la);
  return [cl * Math.cos(lo), cl * Math.sin(lo), Math.sin(la)];
}

export default function GlobeLabels({
  getViewport,
  getCamera,
  labels,
}: {
  /** The live deck viewport (has project() + width/height), or null if not ready. */
  getViewport: () => Viewport | null;
  /** The sub-camera point, for the near-hemisphere visibility test. */
  getCamera: () => { longitude: number; latitude: number };
  labels: TrackLabel[];
}) {
  const elRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const labelsRef = useRef<TrackLabel[]>(labels);
  labelsRef.current = labels;

  // Project + position every frame (camera may be spinning without new data).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const vp = getViewport();
      if (vp) {
        const cam = getCamera();
        const [cx, cy, cz] = unit(cam.longitude, cam.latitude);
        const w = vp.width;
        const h = vp.height;
        for (const l of labelsRef.current) {
          const el = elRefs.current.get(l.id);
          if (!el) continue;
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
          if (x < -100 || y < -50 || x > w + 100 || y > h + 50) {
            el.style.opacity = "0";
            continue;
          }
          el.style.opacity = "1";
          el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        }
      }
      raf = requestAnimationFrame(loop);
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
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1,
            color: `rgb(${l.color[0]}, ${l.color[1]}, ${l.color[2]})`,
            textShadow: "0 0 3px #000, 0 0 3px #000, 0 1px 2px #000",
          }}
        >
          {l.text}
        </div>
      ))}
    </div>
  );
}
