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
const attributionStyle: React.CSSProperties = { color: "#6b7280", fontSize: 11, marginTop: 4 };

/**
 * Provider attribution / linkback. Several sources (Windy especially) REQUIRE
 * this to be shown wherever the cam is displayed — always render it when present.
 */
function Attribution({ cam }: { cam: Cam }) {
  const a = cam.attribution;
  if (!a) return null;
  const text = a.requiredText || a.provider;
  return (
    <div style={attributionStyle}>
      {a.linkUrl ? (
        <a href={a.linkUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#6b7280" }}>
          {text}
        </a>
      ) : (
        text
      )}
    </div>
  );
}

export default function CamViewer({ cam }: { cam: Cam }) {
  return (
    <div>
      <CamMedia cam={cam} />
      <Attribution cam={cam} />
    </div>
  );
}

function CamMedia({ cam }: { cam: Cam }) {
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
