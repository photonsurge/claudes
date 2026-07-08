"use client";

/**
 * ABOUT US — the deck's closing slide. Intentionally a blank placeholder for
 * now: it holds its slot in the rotation (title + reserved space) so the
 * about-us copy/branding can drop in later without re-plumbing the deck.
 * Pointer-inert like the rest of the chrome.
 */
import { accentBorder, type BroadcastTheme } from "./config";

export default function AboutPanel({ theme }: { theme: BroadcastTheme }) {
  return (
    <div
      style={{
        position: "relative",
        width: 400,
        minHeight: 220,
        padding: "20px 24px",
        background: theme.panelBg,
        ...accentBorder(theme.panelBorder, `5px solid ${theme.accent}`),
        borderRadius: 16,
        boxShadow: `0 12px 36px rgba(0,0,0,0.5), 0 0 20px ${theme.accent}28`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: 1.8,
          color: "#dfe7f5",
        }}
      >
        ABOUT US
      </div>
      {/* Reserved — content to come. */}
    </div>
  );
}
