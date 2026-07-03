"use client";

/**
 * Renders one ad's stored media — a <video> for video creative, otherwise an
 * <img>. Bytes are streamed from /api/ads/[adId]/media (cache-busted on edit).
 */
import type { Ad } from "../../lib/ads/types";
import { adMediaUrl } from "../../lib/ads/client";

const frame: React.CSSProperties = {
  width: "100%",
  maxHeight: 360,
  objectFit: "contain",
  background: "#000",
  borderRadius: 8,
  border: "1px solid #1b2030",
  display: "block",
};

export default function AdViewer({ ad }: { ad: Ad }) {
  const src = adMediaUrl(ad);
  if (ad.mediaType === "video") {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <video style={frame} src={src} controls autoPlay muted loop playsInline />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img style={frame} src={src} alt={ad.title} />;
}
