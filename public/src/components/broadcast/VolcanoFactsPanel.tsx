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
import BroadcastCard, { CardSection } from "./BroadcastCard";

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
    <BroadcastCard accent={color} eyebrow="Volcano Facts">
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
        <CardSection>
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
        </CardSection>
      ) : null}

      {info.reportFacts ? (
        <CardSection eyebrow="This week's bulletin, parsed">
          <div style={{ fontSize: 12, fontWeight: 700, color: "#e6eefb" }}>{info.reportFacts}</div>
        </CardSection>
      ) : null}
    </BroadcastCard>
  );
}
