"use client";

/**
 * On-air "second slide" for an active volcano segment — a photo gallery strip
 * plus the richer wiki/Wikidata/USGS facts (type, elevation, last known
 * eruption, near-real-time USGS alert, LLM-parsed VEI/plume height from this
 * week's bulletin). Alternated with TrackInfoPanel (photo+blurb) by
 * BroadcastFrame's volcanoSlide the same way quakeSlide/wideCitiesSlide
 * alternate their own panel pairs — one card of everything ran taller than
 * the frame and cut off, this way each slide fits.
 *
 * Same width/chrome as TrackInfoPanel so the two read as one card that
 * flips pages, not two different widgets. Returns null if the segment carries
 * nothing this panel would add (no gallery/facts/alert/reportFacts) — callers
 * should check that before alternating slides at all.
 */
import type { TrackInfo } from "@photonsurge/shared/director";
import { accentBorder } from "./config";

const USGS_COLOR: Record<string, string> = {
  RED: "#ef4444",
  ORANGE: "#f97316",
  YELLOW: "#eab308",
  GREEN: "#34d399",
};

export function volcanoFactsSlideHasContent(info: TrackInfo | undefined): boolean {
  if (!info) return false;
  return Boolean((info.gallery && info.gallery.length) || info.facts || info.alert || info.reportFacts);
}

export default function VolcanoFactsPanel({ info, color = "#38bdf8" }: { info: TrackInfo; color?: string }) {
  if (!volcanoFactsSlideHasContent(info)) return null;

  return (
    <div
      style={{
        width: 380,
        background: "rgba(8,13,22,0.82)",
        ...accentBorder(`1px solid ${color}44`, `3px solid ${color}`),
        borderRadius: 8,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        fontFamily: "system-ui, sans-serif",
        color: "#e6eefb",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: "#9fb3cc",
          padding: "8px 12px 6px",
        }}
      >
        ▸ VOLCANO FACTS
      </div>

      <div style={{ padding: "0 12px 10px" }}>
        {info.gallery && info.gallery.length ? (
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {info.gallery.slice(0, 4).map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt=""
                style={{ flex: 1, height: 60, objectFit: "cover", borderRadius: 4, display: "block" }}
              />
            ))}
          </div>
        ) : null}

        {info.facts ? (
          <div style={{ fontSize: 12, fontWeight: 700, color: "#e6eefb" }}>{info.facts}</div>
        ) : null}

        {info.alert ? (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(120,140,170,0.14)" }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: (info.alert.colorCode && USGS_COLOR[info.alert.colorCode]) || "#e6eefb",
              }}
            >
              ● USGS {info.alert.colorCode}
              {info.alert.level ? ` / ${info.alert.level}` : ""}
            </div>
            {info.alert.synopsis ? (
              <div style={{ fontSize: 11, lineHeight: 1.4, color: "#cdd9ec", marginTop: 3 }}>{info.alert.synopsis}</div>
            ) : null}
          </div>
        ) : null}

        {info.reportFacts ? (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(120,140,170,0.14)" }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: "#9fb3cc" }}>THIS WEEK'S BULLETIN, PARSED</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#e6eefb", marginTop: 2 }}>{info.reportFacts}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
