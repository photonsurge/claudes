"use client";

/**
 * Full-frame advertisement interstitial — a "commercial break" the auto-director
 * cuts to on its ad cadence. Covers the globe + chrome entirely (opaque black,
 * highest layer) and shows the ad's image or video centred (objectFit: contain,
 * so nothing crops). Driven by `segment.ad`; renders nothing for any other kind.
 *
 * Pointer-inert like the rest of the /watch surface. Video plays muted + looped
 * (browser autoplay + no clash with the audio bed); per-ad audio can come later.
 */
import type { Segment } from "@photonsurge/shared/director";

export default function AdBreak({ segment }: { segment: Segment | null }) {
  const ad = segment?.kind === "ad" ? segment.ad : null;
  if (!ad) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30, // above the globe (auto) and the broadcast chrome (5)
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {ad.mediaType === "video" ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          key={ad.mediaUrl}
          src={ad.mediaUrl}
          autoPlay
          muted
          loop
          playsInline
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={ad.mediaUrl}
          src={ad.mediaUrl}
          alt={ad.title}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
        />
      )}
    </div>
  );
}
