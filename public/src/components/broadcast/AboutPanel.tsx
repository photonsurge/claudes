"use client";

/**
 * About card - the deck's closing slide: the channel's own description + data
 * source credits. Copy comes from ControlState.about (edited per channel on
 * /admin/scenes/:id); every field falls back individually to the built-in
 * G.O.D.S. copy when empty, so an untouched channel reads exactly as before.
 * Rendered on the shared G.O.D.S. chamfered panel chrome. Pointer-inert like
 * the rest of the chrome.
 */
import type { AboutSettings } from "@photonsurge/shared/control";
import type { BroadcastTheme } from "./config";
import { GodsPanel, GodsSectionRule, INK, INK_DIM, GODS_TILE_BORDER } from "./GodsPanel";

const DEFAULT_DISCLAIMER =
  "It is not an official warning service, but a visual awareness and exploration tool for global conditions.";

export default function AboutPanel({
  theme,
  about,
}: {
  theme: BroadcastTheme;
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
    <GodsPanel
      width={400}
      notch={[14, 22]}
      padding="18px 22px 20px"
      gap={14}
      style={{ pointerEvents: "none" }}
    >
      {/* Mixed-case title, so not the ALL-CAPS GodsPanelHeader — but the same
          row anatomy: title + border hairline out to the right. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ color: INK, fontSize: 18, fontWeight: 600, letterSpacing: 1.1, whiteSpace: "nowrap" }}>
          {title}
        </div>
        <div style={{ flex: 1, height: 1, background: GODS_TILE_BORDER }} />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontSize: 13.8,
          lineHeight: 1.45,
          color: theme.textColor,
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
              <strong style={{ color: theme.titleColor, fontWeight: 600 }}>G.O.D.S.</strong> &mdash; Global Orbital Detection
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
          <div style={{ marginTop: 2, display: "flex", flexDirection: "column", gap: 4 }}>
            <GodsSectionRule label="DATA SOURCES" accent={theme.accent} />
            <div style={{ color: INK_DIM, fontSize: 12.7, lineHeight: 1.5 }}>{sources.join(" · ")}</div>
          </div>
        )}

        <p
          style={{
            margin: "2px 0 0",
            paddingTop: 10,
            borderTop: `1px solid ${GODS_TILE_BORDER}`,
            color: "#8fa6b2",
            fontSize: 12.7,
            lineHeight: 1.45,
          }}
        >
          {footer}
        </p>
      </div>
    </GodsPanel>
  );
}
