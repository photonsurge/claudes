"use client";

/**
 * Top-right "LIVE ALERT PANEL": the single most severe active alert, in a
 * pulsing hazard-tinted card. Renders nothing when nothing is active.
 */
import type { AlertFeature } from "../../lib/alerts";
import { SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";
import { topAlert, alertBannerText } from "../../lib/broadcast";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

export default function LiveAlertPanel({
  alerts,
  theme = DEFAULT_THEME,
  compact = false,
}: {
  alerts: AlertFeature[];
  theme?: BroadcastTheme;
  compact?: boolean;
}) {
  const top = topAlert(alerts);
  if (!top) return null;
  const color = SEVERITY_COLORS[top.properties.severityRank] ?? theme.accent;

  return (
    <div
      style={{
        maxWidth: compact ? 240 : 340,
        padding: compact ? "8px 11px" : "10px 14px",
        background: theme.panelBg,
        border: `1px solid ${color}66`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 10,
        boxShadow: `0 8px 26px rgba(0,0,0,0.45), 0 0 14px ${color}33`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        textAlign: "right",
      }}
    >
      <style>{"@keyframes bcast-alertpulse{0%,100%{opacity:1}50%{opacity:0.5}}"}</style>
      <div
        style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: "#9fb0c8",
          marginBottom: 3,
        }}
      >
        LIVE ALERT PANEL
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 7,
          fontSize: compact ? 12 : 14,
          fontWeight: 700,
          color,
          textShadow: "0 1px 2px rgba(0,0,0,0.8)",
        }}
      >
        <span>{alertBannerText(top)}</span>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 8px ${color}`,
            animation: "bcast-alertpulse 1.2s ease-in-out infinite",
            flex: "0 0 auto",
          }}
        />
      </div>
    </div>
  );
}
