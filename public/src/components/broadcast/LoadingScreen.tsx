"use client";

/**
 * Full-bleed cover over the globe while its weather textures decode. Only ever
 * shows once, on cold start (see useGlobeReadyOnce) — by the time it fades out
 * every variable's texture at the current fhr is already decoded, so a
 * director cut or map-type switch right after never hits a cold network fetch.
 */
import { useEffect, useState } from "react";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

const FADE_MS = 500;

export default function LoadingScreen({
  visible,
  theme = DEFAULT_THEME,
}: {
  visible: boolean;
  theme?: BroadcastTheme;
}) {
  // Stay mounted through the fade-out, then unmount — avoids a permanent
  // pointer-events-none div sitting over the capture surface forever.
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(t);
  }, [visible]);

  if (!mounted) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#05070c",
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: "none",
      }}
    >
      <style>{"@keyframes bcast-loadspin{to{transform:rotate(360deg)}}"}</style>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <svg
          width={56}
          height={56}
          viewBox="0 0 40 40"
          aria-hidden
          style={{ animation: "bcast-loadspin 1.1s linear infinite" }}
        >
          <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
          <circle
            cx="20"
            cy="20"
            r="17"
            fill="none"
            stroke={theme.accent}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="80 200"
          />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 14.3, fontWeight: 800, letterSpacing: 3, color: theme.titleColor }}>{theme.name}</span>
          <span style={{ fontSize: 12.1, fontWeight: 700, letterSpacing: 2, color: theme.accent }}>
            ACQUIRING SIGNAL…
          </span>
        </div>
      </div>
    </div>
  );
}
