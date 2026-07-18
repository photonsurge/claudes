"use client";

/**
 * About G.O.D.S. - the deck's closing slide. Pointer-inert like the rest of the
 * chrome.
 */
import { accentBorderRight, GLASS_BG, type BroadcastTheme } from "./config";

export default function AboutPanel({ theme }: { theme: BroadcastTheme }) {
  return (
    <div
      style={{
        position: "relative",
        width: 400,
        minHeight: 420,
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
          color: "#dfe7f5",
        }}
      >
        About G.O.D.S.
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
        <p style={{ margin: 0 }}>
          <strong style={{ color: "#ffffff", fontWeight: 800 }}>G.O.D.S.</strong> &mdash; Global Orbital Detection
          System &mdash; is a live visual monitoring platform created by Thronix and built with PhotonSurge technology.
        </p>
        <p style={{ margin: 0 }}>
          It brings together public weather, earthquake, volcanic and natural hazard data into a single cinematic global
          dashboard. The system is designed to turn complex live datasets into something easier to watch, understand and
          explore.
        </p>
        <p style={{ margin: 0 }}>
          G.O.D.S. combines automated data workers, map overlays, event panels and orbital-style visual scenes to create
          a real-time command interface for global activity.
        </p>
        <p style={{ margin: 0 }}>
          From storm systems and ocean conditions to seismic events and volcanic reports, G.O.D.S. helps show the planet
          as an active, moving system.
        </p>
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
          It is not an official warning service, but a visual awareness and exploration tool for global conditions.
        </p>
      </div>
    </div>
  );
}
