"use client";

/**
 * Small "coming up" hint stacked with the SYSLOG feed, bottom-right — the
 * director's best-guess preview of what plays after the current segment
 * (score-ranked at the last cut, not a committed pick, so it's a hint rather
 * than a promise of exactly what airs next).
 */
import type { SegmentKind } from "@photonsurge/shared/director";

export default function UpNextPanel({ items }: { items: { kind: SegmentKind; title: string }[] }) {
  if (!items.length) return null;
  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: 12.1,
        fontWeight: 700,
        letterSpacing: 0.4,
        color: "#9fb0c8",
        textShadow: "0 1px 3px rgba(0,0,0,0.85)",
        textAlign: "right",
        pointerEvents: "none",
      }}
    >
      UP NEXT · {items.map((u) => u.title).join("  ·  ")}
    </div>
  );
}
