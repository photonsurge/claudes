"use client";

/**
 * Advertisement interstitial — a "commercial break" the auto-director cuts to on
 * its ad cadence. Rendered as a bounded card, not a full-screen takeover, so the
 * globe keeps spinning visibly behind it (the broadcast reads as "still live"
 * during the break). Driven by `segment.ad`; renders nothing for any other kind.
 *
 * Cross-fades in/out rather than popping — the outgoing card is kept mounted
 * (holding its own content, not the live `ad` prop) until its fade-out finishes,
 * so both a hard cut in and a hard cut out feel like part of the same broadcast.
 *
 * Pointer-inert like the rest of the /watch surface. Video plays muted + looped
 * (browser autoplay + no clash with the audio bed); per-ad audio can come later.
 */
import { useEffect, useRef, useState } from "react";
import type { Segment } from "@photonsurge/shared/director";

const MAX_W = "min(70vw, 900px)";
const MAX_H = "62vh";
const FADE_MS = 450;

type AirAd = NonNullable<Segment["ad"]>;

export default function AdBreak({ segment }: { segment: Segment | null }) {
  const ad = segment?.kind === "ad" ? (segment.ad ?? null) : null;
  const [shown, setShown] = useState<AirAd | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (ad) {
      setShown(ad);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    hideTimer.current = setTimeout(() => setShown(null), FADE_MS);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [ad?.adId]);

  if (!shown) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30, // above the globe (auto) and the broadcast chrome (5)
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      <div
        style={{
          position: "relative",
          borderRadius: 14,
          overflow: "hidden",
          background: "rgba(6, 10, 20, 0.55)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 12,
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.65)",
            background: "rgba(0,0,0,0.35)",
            padding: "3px 8px",
            borderRadius: 999,
          }}
        >
          Advertisement
        </div>
        {shown.mediaType === "video" ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            key={shown.mediaUrl}
            src={shown.mediaUrl}
            autoPlay
            muted
            loop
            playsInline
            style={{ maxWidth: MAX_W, maxHeight: MAX_H, objectFit: "contain", display: "block" }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={shown.mediaUrl}
            src={shown.mediaUrl}
            alt={shown.title}
            style={{ maxWidth: MAX_W, maxHeight: MAX_H, objectFit: "contain", display: "block" }}
          />
        )}
      </div>
    </div>
  );
}
