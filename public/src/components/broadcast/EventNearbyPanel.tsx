"use client";

/**
 * "Who's affected" panel for an on-air targeted event (storm / quake / aircraft
 * / ship). Given the event's [lng,lat] it shows the cities within range — a
 * featured city slot that cycles through every nearby city (photo + Wikipedia
 * blurb when the City doc has one, worker-cached; see enrich:wiki), a compact
 * list of the other nearby cities with population + distance, and a featured
 * webcam slot that likewise cycles through every nearby cam, actually playing
 * its feed (live stream / timelapse loop / still, same fallback order as
 * CamViewer) rather than a row of static thumbnails. Pure presentation inside
 * the scaled broadcast stage; pointer-inert.
 */
import { useEffect, useState } from "react";
import type { City } from "../../lib/cities";
import { formatPopulation } from "../../lib/cities";
import type { Cam } from "../../lib/cams/types";
import { nearby, formatKm } from "../../lib/geo";

const CITY_RADIUS_KM = 500;
const CAM_RADIUS_KM = 400;
const MAX_CITY_ROWS = 6;
/** Seconds the featured city/cam slide holds before advancing to the next. */
const FEATURED_HOLD_MS = 7000;

const cityPoint = (c: City): [number, number] => [c.lng, c.lat];
const camPoint = (c: Cam): [number, number] | null =>
  Number.isFinite(c.lng) && Number.isFinite(c.lat) ? [c.lng, c.lat] : null;

export default function EventNearbyPanel({
  center,
  cities,
  cams,
  color = "#38bdf8",
}: {
  center: [number, number];
  cities: City[];
  cams: Cam[];
  color?: string;
}) {
  // Cities with a real population (or capitals) so tiny unnamed places don't
  // crowd out the notable ones; nearest first.
  const near = nearby(
    cities.filter((c) => (c.population ?? 0) > 0 || c.isCapital),
    center,
    cityPoint,
    CITY_RADIUS_KM,
  );
  const nearCams = nearby(cams, center, camPoint, CAM_RADIUS_KM);

  // Cycle the featured slot through every nearby city, nearest first, looping.
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (near.length <= 1) return;
    const iv = setInterval(() => setSlide((n) => n + 1), FEATURED_HOLD_MS);
    return () => clearInterval(iv);
  }, [near.length]);

  // Same cycling pattern for the webcams — one full-size playing feed at a
  // time rather than a row of static thumbnails, looping through ALL of them
  // (no arbitrary "+N more" cutoff; the slideshow is how they all get shown).
  const [camSlide, setCamSlide] = useState(0);
  useEffect(() => {
    if (nearCams.length <= 1) return;
    const iv = setInterval(() => setCamSlide((n) => n + 1), FEATURED_HOLD_MS);
    return () => clearInterval(iv);
  }, [nearCams.length]);

  if (!near.length && !nearCams.length) return null;

  const featuredEntry = near.length ? near[slide % near.length] : undefined;
  const featured = featuredEntry?.item;
  const featuredDist = featuredEntry?.distanceKm;
  const rest = near.filter((n) => n.item !== featured);
  const shownRows = rest.slice(0, MAX_CITY_ROWS);
  const moreCities = rest.length - shownRows.length;
  const featuredCamEntry = nearCams.length ? nearCams[camSlide % nearCams.length] : undefined;

  return (
    <div
      style={{
        width: 440,
        background: "rgba(8,13,22,0.82)",
        border: `1px solid ${color}44`,
        borderLeft: `3px solid ${color}`,
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
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: "#9fb3cc",
          padding: "10px 16px 7px",
        }}
      >
        ▸ NEAR THIS EVENT
      </div>

      {/* Featured city — photo + blurb; slot cycles through every nearby city. */}
      {featured ? (
        <div style={{ padding: "0 16px 13px" }}>
          {featured.wikiThumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={featured.wikiThumb}
              alt={featured.name}
              style={{
                width: "100%",
                height: 175,
                objectFit: "cover",
                borderRadius: 7,
                display: "block",
                marginBottom: 9,
              }}
            />
          ) : null}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>{featured.name}</span>
            {featuredDist != null ? (
              <span style={{ fontSize: 14, fontWeight: 700, color }}>{formatKm(featuredDist)}</span>
            ) : null}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#aebfd6", marginTop: 2 }}>
            {[featured.country, formatPopulation(featured.population), featured.isCapital ? "capital" : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {featured.wikiExtract ? (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: "#cdd9ec",
                marginTop: 7,
                display: "-webkit-box",
                WebkitLineClamp: 8,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {featured.wikiExtract}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Other nearby cities. */}
      {shownRows.length ? (
        <div style={{ borderTop: "1px solid rgba(120,140,170,0.14)", padding: "8px 16px 10px" }}>
          {shownRows.map((n) => (
            <div
              key={n.item.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 10,
                fontSize: 13,
                padding: "3px 0",
              }}
            >
              <span style={{ fontWeight: 700, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {n.item.name}
              </span>
              <span style={{ color: "#8ea3bf", whiteSpace: "nowrap" }}>
                {[formatPopulation(n.item.population), formatKm(n.distanceKm)].filter(Boolean).join(" · ")}
              </span>
            </div>
          ))}
          {moreCities > 0 ? (
            <div style={{ fontSize: 11, color: "#7d8da5", marginTop: 4, opacity: 0.75 }}>
              +{moreCities} more within {CITY_RADIUS_KM} km
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Featured webcam — actually playing (live/timelapse/still fallback);
          slot cycles through every nearby cam, same rhythm as the city slide. */}
      {featuredCamEntry ? (
        <div style={{ borderTop: "1px solid rgba(120,140,170,0.14)", padding: "9px 16px 13px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: "#9fb3cc", marginBottom: 8 }}>
            ▸ LIVE WEBCAMS
          </div>
          <NearbyCamMedia cam={featuredCamEntry.item} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {featuredCamEntry.item.title}
            </span>
            <span style={{ fontSize: 11, color, fontWeight: 700, whiteSpace: "nowrap" }}>
              {formatKm(featuredCamEntry.distanceKm)}
            </span>
          </div>
          {featuredCamEntry.item.attribution ? (
            <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
              {featuredCamEntry.item.attribution.requiredText || featuredCamEntry.item.attribution.provider}
            </div>
          ) : null}
          {nearCams.length > 1 ? (
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              {nearCams.map((n, i) => (
                <span
                  key={n.item.camId}
                  style={{
                    flex: 1,
                    height: 2,
                    borderRadius: 1,
                    background: i === camSlide % nearCams.length ? color : "rgba(255,255,255,0.18)",
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const CAM_FRAME_H = 130;
const camFrameStyle: React.CSSProperties = {
  width: "100%",
  height: CAM_FRAME_H,
  objectFit: "cover",
  borderRadius: 6,
  display: "block",
  background: "#0b0f16",
  border: "none",
};

/** The best available media for one cam — prefers a true live stream, then a
 *  looping timelapse, then the still image (mirrors CamViewer's fallback
 *  order), tuned for the pointer-inert broadcast overlay: no controls, muted
 *  autoplay so it just plays as part of the furniture. */
function NearbyCamMedia({ cam }: { cam: Cam }) {
  const live = cam.live;

  if (live?.kind === "youtube") {
    return (
      <iframe
        style={camFrameStyle}
        src={`https://www.youtube.com/embed/${live.url}?autoplay=1&mute=1&controls=0&modestbranding=1`}
        title={cam.title}
        allow="autoplay; encrypted-media; picture-in-picture"
      />
    );
  }
  if (live?.kind === "mp4" || live?.kind === "hls") {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <video style={camFrameStyle} src={live.url} autoPlay muted loop playsInline />;
  }
  if (live?.kind === "iframe") {
    return <iframe style={camFrameStyle} src={live.url} title={cam.title} allow="autoplay" />;
  }
  if (cam.timelapseUrl) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <video style={camFrameStyle} src={cam.timelapseUrl} autoPlay muted loop playsInline />;
  }
  if (cam.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img style={camFrameStyle} src={cam.imageUrl} alt={cam.title} />;
  }
  return (
    <div style={{ ...camFrameStyle, display: "flex", alignItems: "center", justifyContent: "center", color: "#8b95a7", fontSize: 11 }}>
      No feed
    </div>
  );
}
