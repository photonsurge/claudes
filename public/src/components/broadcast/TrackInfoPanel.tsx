"use client";

/**
 * On-air "Track Info" card for a notable aircraft/ship the director has put up, or
 * (reusing the same photo+blurb layout) an active volcano segment — a photo
 * (planespotters airframe shot or the Wikipedia lead image), the subject's
 * name + type/operator/flag, a short Wikipedia blurb, and a couple of live stats
 * (altitude/heading or speed/course) pulled from the segment's detail rows.
 *
 * Driven entirely by `segment.trackInfo`, which the worker attaches when a live
 * track matches the notable-tracks catalog (or a volcano segment is built) — so it
 * appears exactly when the globe highlight ring is on that subject. The heading is
 * derived from `segment.kind`, not from `trackInfo.category` (which is catalog
 * free-text for flights/ships). Pure presentation inside the scaled
 * broadcast stage; pointer-inert. Returns null for any segment without trackInfo.
 */
import type { Segment } from "@photonsurge/shared/director";
import { accentBorder } from "./config";

/** Detail rows that change moment-to-moment — worth showing live under the photo. */
const LIVE_LABELS = new Set(["Altitude", "Heading", "Speed", "Course"]);

export default function TrackInfoPanel({
  segment,
  color = "#38bdf8",
}: {
  segment: Segment;
  color?: string;
}) {
  const info = segment.trackInfo;
  if (!info) return null;

  const heading = info.vip
    ? "VIP TRACK"
    : segment.kind === "volcano"
      ? "ACTIVE VOLCANO"
      : segment.kind === "flight"
        ? "NOTABLE AIRCRAFT"
        : segment.kind === "ship"
          ? "NOTABLE VESSEL"
          : "NOTABLE TRACK";
  const title = info.label || segment.title;
  // Manufacturer reads redundant when `type` already leads with it (e.g. "Boeing VC-25A").
  const manufacturer =
    info.manufacturer && !info.type?.toLowerCase().startsWith(info.manufacturer.toLowerCase()) ? info.manufacturer : undefined;
  const typeLine = [manufacturer, info.type, info.operator].filter(Boolean).join(" · ");
  const idLine = [info.flag ? `${info.flag} ${info.country ?? ""}`.trim() : info.country, info.registration]
    .filter(Boolean)
    .join(" · ");
  const liveStats = (segment.details ?? []).filter((d) => LIVE_LABELS.has(d.label));

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
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: info.vip ? "#ffd76a" : "#9fb3cc",
          padding: "8px 12px 6px",
        }}
      >
        {info.vip ? <span aria-hidden>★</span> : null}▸ {heading}
        {info.category ? (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: 0.6,
              color: "#9fb3cc",
              background: "rgba(159,179,204,0.14)",
              padding: "2px 6px",
              borderRadius: 999,
              textTransform: "uppercase",
            }}
          >
            {info.category}
          </span>
        ) : null}
      </div>

      <div style={{ padding: "0 12px 10px" }}>
        {info.photoUrl ? (
          <div style={{ position: "relative", marginBottom: 7 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={info.photoUrl}
              alt={title}
              style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 6, display: "block" }}
            />
            {info.photoCredit ? (
              <div
                style={{
                  position: "absolute",
                  right: 4,
                  bottom: 4,
                  fontSize: 8,
                  color: "#dbe6f6",
                  background: "rgba(0,0,0,0.5)",
                  padding: "1px 4px",
                  borderRadius: 3,
                }}
              >
                © {info.photoCredit}
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", lineHeight: 1.15 }}>{title}</div>
        {typeLine ? (
          <div style={{ fontSize: 11, fontWeight: 700, color, marginTop: 2 }}>{typeLine}</div>
        ) : null}
        {idLine ? (
          <div style={{ fontSize: 11, fontWeight: 600, color: "#aebfd6", marginTop: 1 }}>{idLine}</div>
        ) : null}
        {info.statusLine ? (
          <div style={{ fontSize: 10.5, fontWeight: 600, color: "#8ea3bf", marginTop: 1 }}>{info.statusLine}</div>
        ) : null}

        {info.extract ? (
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.45,
              color: "#cdd9ec",
              marginTop: 6,
              display: "-webkit-box",
              WebkitLineClamp: 9,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {info.extract}
          </div>
        ) : null}
        {info.sourceUrl ? (
          <div style={{ fontSize: 9.5, color: "#63748e", marginTop: 5 }}>Source: Smithsonian GVP</div>
        ) : null}
      </div>

      {liveStats.length ? (
        <div
          style={{
            borderTop: "1px solid rgba(120,140,170,0.14)",
            padding: "6px 12px 9px",
            display: "flex",
            flexWrap: "wrap",
            gap: "2px 14px",
          }}
        >
          {liveStats.map((d) => (
            <div key={d.label} style={{ fontSize: 11, whiteSpace: "nowrap" }}>
              <span style={{ color: "#8ea3bf" }}>{d.label} </span>
              <span style={{ fontWeight: 700, color: "#e6eefb" }}>{d.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
