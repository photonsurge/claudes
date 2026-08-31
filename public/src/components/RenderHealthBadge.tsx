"use client";

/**
 * Red "SOFTWARE RENDER" chip for the /watch surface — appears ONLY inside an
 * OBS browser source, and only when WebGL initialised on a CPU rasteriser
 * (llvmpipe / SwiftShader / Basic Render Driver) instead of the real GPU.
 * Deliberately drawn into the capture: the operator sees the fault straight in
 * the OBS preview of that encoder, which is where they'd otherwise only notice
 * "everything is mysteriously slow". Renders nothing on a healthy GPU or in a
 * normal browser tab.
 */
import { isObsRender, useRendererInfo } from "../lib/broadcast-render";

export default function RenderHealthBadge() {
  const info = useRendererInfo();
  // info is null until Globe's deck init reports in (client-only), so this can
  // never mismatch hydration; the isObsRender() gate keeps it out of viewers'
  // browser tabs even if their machine software-renders.
  if (!info?.software || !isObsRender()) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        zIndex: 60,
        background: "#8f1d1d",
        color: "#fff",
        borderRadius: 6,
        padding: "5px 10px",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.4,
        pointerEvents: "none",
      }}
    >
      ⚠ SOFTWARE RENDER — {info.renderer.slice(0, 64)}
    </div>
  );
}
