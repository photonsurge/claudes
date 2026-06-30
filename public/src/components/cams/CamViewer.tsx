"use client";

/**
 * Renders the best available media for one cam, preferring a true live stream,
 * then a looping timelapse, then the still image. HLS in non-Safari browsers
 * needs hls.js (not wired yet) — we still render the <video> and surface a hint
 * rather than silently showing nothing.
 */
import type { Cam } from "../../lib/cams/types";

const frame: React.CSSProperties = {
  width: "100%",
  aspectRatio: "16 / 9",
  background: "#000",
  borderRadius: 8,
  border: "1px solid #1b2030",
  display: "block",
};
const hint: React.CSSProperties = { color: "#8b95a7", fontSize: 12, marginTop: 6 };

export default function CamViewer({ cam }: { cam: Cam }) {
  const live = cam.live;

  if (live) {
    if (live.kind === "youtube") {
      return (
        <div>
          <iframe
            style={frame}
            src={`https://www.youtube.com/embed/${live.url}?autoplay=1&mute=1`}
            title={cam.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
          <div style={hint}>Live · YouTube</div>
        </div>
      );
    }
    if (live.kind === "mp4" || live.kind === "hls") {
      return (
        <div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video style={frame} src={live.url} controls autoPlay muted playsInline />
          <div style={hint}>
            Live · {live.kind.toUpperCase()}
            {live.kind === "hls" ? " (Chrome/Firefox need hls.js — coming soon)" : ""}
          </div>
        </div>
      );
    }
    // iframe
    return (
      <div>
        <iframe style={frame} src={live.url} title={cam.title} allow="autoplay; fullscreen" allowFullScreen />
        <div style={hint}>Live · embedded</div>
      </div>
    );
  }

  if (cam.timelapseUrl) {
    return (
      <div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video style={frame} src={cam.timelapseUrl} controls autoPlay muted loop playsInline />
        <div style={hint}>Timelapse loop</div>
      </div>
    );
  }

  if (cam.imageUrl) {
    return (
      <div>
        {/* Provider stills are remote and unoptimised; plain img avoids next/image domain config. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img style={frame} src={cam.imageUrl} alt={cam.title} />
        <div style={hint}>Latest still</div>
      </div>
    );
  }

  return (
    <div style={{ ...frame, display: "flex", alignItems: "center", justifyContent: "center", color: "#8b95a7", fontSize: 13 }}>
      No media for this cam yet
    </div>
  );
}
