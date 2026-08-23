"use client";

/**
 * Full-bleed cover shown before the broadcast goes live: a "starting in…"
 * countdown timer plus brief About Us credits. Driven by ControlState.startAt
 * (a wall-clock ms target set from DirectorPanel) — visible whenever that
 * target is set and still in the future, on top of everything else (including
 * LoadingScreen), so the reveal is always the countdown finishing, never the
 * globe popping in mid-count.
 */
import { useEffect, useState } from "react";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

const FADE_MS = 600;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function StartCountdown({
  startAt,
  theme = DEFAULT_THEME,
}: {
  startAt: number | null;
  theme?: BroadcastTheme;
}) {
  const [now, setNow] = useState(() => Date.now());
  const live = startAt != null && now < startAt;

  // Stay mounted through the fade-out, then unmount — mirrors LoadingScreen so
  // this never leaves a stray pointer-events-none div over the capture surface.
  const [mounted, setMounted] = useState(live);
  useEffect(() => {
    if (live) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(t);
  }, [live]);

  // Only tick the clock while a countdown is actually mounted.
  useEffect(() => {
    if (!mounted) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [mounted]);

  if (!mounted || startAt == null) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 55,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#05070c",
        opacity: live ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22,
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: 4, color: theme.titleColor }}>{theme.name}</span>
          <span style={{ fontSize: 13.2, fontWeight: 700, letterSpacing: 2, color: theme.accent }}>
            {theme.tagline}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 12.1, fontWeight: 700, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>
            BROADCAST STARTING IN
          </span>
          <span
            style={{
              fontSize: 70.4,
              fontWeight: 800,
              color: "#fff",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
          >
            {formatRemaining(startAt - now)}
          </span>
        </div>
        <span style={{ fontSize: 13.2, color: "rgba(255,255,255,0.45)", letterSpacing: 1 }}>
          by Thronix, powered by PhotonSurge
        </span>
      </div>
    </div>
  );
}
