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
import type { CSSProperties } from "react";
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

const imgStyle = (height: number): CSSProperties => ({
  width: "100%",
  height,
  objectFit: "cover",
  borderRadius: 6,
  display: "block",
});

/**
 * The volcano's photos (up to 4), sized to actually read on air rather than the
 * old 60px-tall thumbnail strip. Layout adapts to how many we have: a lone photo
 * goes full-bleed, a pair sits two-up at the sibling TrackInfoPanel's own 150px
 * height, three leads with a hero over two thumbs, and four fills a 2×2 grid — so
 * every photo stays large instead of collapsing into a wall of tiny squares.
 */
function VolcanoGallery({ urls }: { urls: string[] }) {
  const pics = urls.slice(0, 4);
  /* eslint-disable @next/next/no-img-element */
  if (pics.length === 1) {
    return <img src={pics[0]} alt="" style={{ ...imgStyle(180), marginBottom: 10 }} />;
  }
  if (pics.length === 2) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        {pics.map((url) => (
          <img key={url} src={url} alt="" style={imgStyle(150)} />
        ))}
      </div>
    );
  }
  if (pics.length === 4) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        {pics.map((url) => (
          <img key={url} src={url} alt="" style={imgStyle(122)} />
        ))}
      </div>
    );
  }
  // Three: a hero over a two-up thumb row.
  return (
    <div style={{ marginBottom: 10 }}>
      <img src={pics[0]} alt="" style={{ ...imgStyle(150), marginBottom: 6 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {pics.slice(1).map((url) => (
          <img key={url} src={url} alt="" style={imgStyle(100)} />
        ))}
      </div>
    </div>
  );
  /* eslint-enable @next/next/no-img-element */
}

export default function VolcanoFactsPanel({ info, color = "#38bdf8" }: { info: TrackInfo; color?: string }) {
  if (!volcanoFactsSlideHasContent(info)) return null;

  return (
    <BroadcastCard accent={color} eyebrow="Volcano Facts">
      {info.gallery && info.gallery.length ? (
        <VolcanoGallery urls={info.gallery} />
      ) : null}

      {info.facts ? (
        <div style={{ fontSize: 13.2, fontWeight: 700, color: "#e6eefb" }}>{info.facts}</div>
      ) : null}

      {info.alert ? (
        <CardSection>
          <div
            style={{
              fontSize: 12.1,
              fontWeight: 800,
              color: (info.alert.colorCode && USGS_COLOR[info.alert.colorCode]) || "#e6eefb",
            }}
          >
            ● USGS {info.alert.colorCode}
            {info.alert.level ? ` / ${info.alert.level}` : ""}
          </div>
          {info.alert.synopsis ? (
            <div style={{ fontSize: 12.1, lineHeight: 1.4, color: "#cdd9ec", marginTop: 3 }}>{info.alert.synopsis}</div>
          ) : null}
        </CardSection>
      ) : null}

      {info.reportFacts ? (
        <CardSection eyebrow="This week's bulletin, parsed">
          <div style={{ fontSize: 13.2, fontWeight: 700, color: "#e6eefb" }}>{info.reportFacts}</div>
        </CardSection>
      ) : null}
    </BroadcastCard>
  );
}
