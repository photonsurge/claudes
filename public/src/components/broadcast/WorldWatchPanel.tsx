"use client";

/**
 * Top-right "WORLD WATCH": an always-on, whole-planet situation summary — how
 * many active warnings (bucketed by severity) and the biggest earthquake in the
 * last day. Unlike the single-event LiveAlertPanel it never hides and doesn't
 * follow the operator's show-alerts/seismic toggles: it pulls its own global
 * tally (see useWorldWatch) so the broadcast always carries a state-of-the-world
 * readout. Pointer-inert like the rest of the chrome.
 */
import { useWorldWatch } from "../../lib/world-watch";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

/** "Extreme" → "EXT", "Severe" → "SEV" … — compact chip label. */
const abbrev = (label: string) => label.slice(0, 3).toUpperCase();

function Row({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#9fb0c8" }}>
        {icon} {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{children}</div>
    </div>
  );
}

export default function WorldWatchPanel({ theme = DEFAULT_THEME }: { theme?: BroadcastTheme }) {
  const s = useWorldWatch();
  const chips = s.bySeverity.slice(0, 3); // top few severities; total carries the rest
  const topColor = chips[0]?.color ?? theme.accent;
  const hasExtreme = chips[0]?.rank === 4;
  const quiet = s.alertTotal === 0 && s.quakeCount === 0;

  return (
    <div
      style={{
        position: "relative",
        width: 258,
        padding: "10px 14px",
        background: theme.panelBg,
        border: theme.panelBorder,
        borderLeft: `3px solid ${topColor}`,
        borderRadius: 12,
        boxShadow: `0 8px 26px rgba(0,0,0,0.45), 0 0 14px ${topColor}22`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 7,
      }}
    >
      <style>{"@keyframes bcast-wwpulse{0%,100%{opacity:1}50%{opacity:0.45}}"}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: "#dfe7f5",
        }}
      >
        <span>WORLD WATCH</span>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1, color: theme.accent }}>
          LAST 24H
        </span>
      </div>

      {quiet ? (
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#7f8ea6",
            textAlign: "right",
            letterSpacing: 0.5,
          }}
        >
          MONITORING · ALL QUIET
        </div>
      ) : (
        <>
          <Row icon="⚠" label="ALERTS">
            {chips.map((c) => (
              <span key={c.rank} style={{ fontSize: 12, fontWeight: 800, color: c.color }}>
                {c.count} {abbrev(c.label)}
              </span>
            ))}
            <span
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: "#e6edf7",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {s.alertTotal}
              {hasExtreme ? (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: topColor,
                    boxShadow: `0 0 8px ${topColor}`,
                    animation: "bcast-wwpulse 1.2s ease-in-out infinite",
                  }}
                />
              ) : null}
            </span>
          </Row>

          <Row icon="🌐" label="SEISMIC">
            <span
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: s.maxMag >= 6 ? "#f97316" : "#43d9ff",
              }}
            >
              {s.maxMag > 0 ? `M${s.maxMag.toFixed(1)}` : "—"}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#9fb0c8" }}>
              {s.quakeCount} quakes
            </span>
          </Row>
        </>
      )}
    </div>
  );
}
