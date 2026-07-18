"use client";

/**
 * Bottom-left "control room" flavor: a fading stream of recent worker events
 * (map refresh, tracks/cities/alerts ticks) — ambient telemetry, not meant to
 * be read closely. Newest line at the bottom; older lines drift upward and
 * fade to transparent as they age, then drop off.
 */
import { useEventLog, LOG_LIFETIME_MS } from "../../lib/event-log";

export default function SyslogFeed() {
  const lines = useEventLog();
  if (lines.length === 0) return null;

  const now = Date.now();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column-reverse",
        gap: 3,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12.1,
        letterSpacing: 0.2,
        pointerEvents: "none",
      }}
    >
      <style>{"@keyframes bcast-logline{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}"}</style>
      {lines.map((l) => {
        const fade = Math.max(0, 1 - (now - l.at) / LOG_LIFETIME_MS);
        return (
          <div
            key={l.id}
            style={{
              opacity: fade,
              animation: "bcast-logline 0.35s ease-out",
              textShadow: "0 1px 3px rgba(0,0,0,0.9)",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: "#5c7a94" }}>{formatClock(l.at)}</span>{" "}
            <span style={{ color: "#6fa8dc", fontWeight: 700 }}>[SYS]</span>{" "}
            <span style={{ color: "#8fe3b0" }}>{l.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatClock(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
