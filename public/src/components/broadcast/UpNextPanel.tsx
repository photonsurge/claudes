"use client";

/**
 * Small "coming up" hint stacked with the SYSLOG feed, bottom-right — the
 * director's best-guess preview of what plays after the current segment
 * (score-ranked at the last cut, not a committed pick, so it's a hint rather
 * than a promise of exactly what airs next). One line per upcoming shot so
 * each can carry its locating detail ("Earthquake — M5.6 · Southern Sumatra")
 * instead of a bare kind name.
 */
import { upNextLabel, type UpNextItem } from "@photonsurge/shared/director";
import { useBroadcastTheme } from "./theme-context";

export default function UpNextPanel({ items }: { items: UpNextItem[] }) {
  const theme = useBroadcastTheme();
  if (!items.length) return null;
  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: 13.8,
        fontWeight: 700,
        letterSpacing: 0.4,
        color: theme.mutedColor,
        textShadow: "0 1px 3px rgba(0,0,0,0.85)",
        textAlign: "right",
        pointerEvents: "none",
      }}
    >
      {items.map((u, i) => (
        <div key={i}>
          {i === 0 ? "UP NEXT · " : ""}
          {upNextLabel(u)}
        </div>
      ))}
    </div>
  );
}
