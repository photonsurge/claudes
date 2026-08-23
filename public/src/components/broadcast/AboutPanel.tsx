"use client";

/**
 * About card - the deck's closing slide: the channel's own description + data
 * source credits. Copy comes from ControlState.about (edited per channel on
 * /admin/scenes/:id); every field falls back individually to the built-in
 * G.O.D.S. copy when empty, so an untouched channel reads exactly as before.
 * Carries the shared ACTIVE FEED at its foot like every other slide, so the
 * rolling state-of-the-world readout stays on screen through the whole
 * rotation instead of vanishing here. Pointer-inert like the rest of the chrome.
 */
import type { AboutSettings } from "@photonsurge/shared/control";
import type { WorldWatchItem } from "../../lib/broadcast";
import { accentBorderRight, GLASS_BG, type BroadcastTheme } from "./config";
import FeedSection from "./FeedSection";

const DEFAULT_DISCLAIMER =
  "It is not an official warning service, but a visual awareness and exploration tool for global conditions.";

export default function AboutPanel({
  theme,
  feed,
  about,
}: {
  theme: BroadcastTheme;
  feed: WorldWatchItem[];
  /** Per-channel copy (ControlState.about). Absent/empty fields = built-in G.O.D.S. copy. */
  about?: AboutSettings;
}) {
  const title = about?.title.trim() || "About G.O.D.S.";
  // A blank line starts a new paragraph; empty body = the built-in copy below.
  const paragraphs = about?.body.trim()
    ? about.body
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
    : null;
  const sources = (about?.sources ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const footer = about?.footer.trim() || DEFAULT_DISCLAIMER;

  return (
    <div
      style={{
        position: "relative",
        width: 400,
        padding: "20px 24px 22px",
        background: GLASS_BG,
        ...accentBorderRight(theme.panelBorder, `5px solid ${theme.accent}`),
        borderRadius: 16,
        boxShadow: `0 12px 36px rgba(0,0,0,0.5), 0 0 20px ${theme.accent}28`,
        backdropFilter: "blur(11px)",
        WebkitBackdropFilter: "blur(11px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          fontSize: 15.4,
          fontWeight: 800,
          letterSpacing: 1.1,
          color: theme.titleColor,
        }}
      >
        {title}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontSize: 13.8,
          lineHeight: 1.45,
          color: "rgba(224,232,246,0.88)",
        }}
      >
        {paragraphs ? (
          paragraphs.map((p, i) => (
            <p key={i} style={{ margin: 0 }}>
              {p}
            </p>
          ))
        ) : (
          <>
            <p style={{ margin: 0 }}>
              <strong style={{ color: "#ffffff", fontWeight: 800 }}>G.O.D.S.</strong> &mdash; Global Orbital Detection
              System &mdash; is a live visual monitoring platform created by Thronix and built with PhotonSurge
              technology.
            </p>
            <p style={{ margin: 0 }}>
              It brings together public weather, earthquake, volcanic and natural hazard data into a single cinematic
              global dashboard. The system is designed to turn complex live datasets into something easier to watch,
              understand and explore.
            </p>
            <p style={{ margin: 0 }}>
              G.O.D.S. combines automated data workers, map overlays, event panels and orbital-style visual scenes to
              create a real-time command interface for global activity.
            </p>
            <p style={{ margin: 0 }}>
              From storm systems and ocean conditions to seismic events and volcanic reports, G.O.D.S. helps show the
              planet as an active, moving system.
            </p>
          </>
        )}

        {sources.length > 0 && (
          <div style={{ marginTop: 2 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 1.4,
                color: theme.mutedColor,
                marginBottom: 3,
              }}
            >
              DATA SOURCES
            </div>
            <div style={{ color: "rgba(203,216,235,0.85)", fontSize: 12.7, lineHeight: 1.5 }}>
              {sources.join(" · ")}
            </div>
          </div>
        )}

        <p
          style={{
            margin: "2px 0 0",
            paddingTop: 10,
            borderTop: `1px solid ${theme.accent}38`,
            color: "rgba(203,216,235,0.8)",
            fontSize: 12.7,
            lineHeight: 1.45,
          }}
        >
          {footer}
        </p>
      </div>

      <FeedSection feed={feed} theme={theme} visible={4} />
    </div>
  );
}
