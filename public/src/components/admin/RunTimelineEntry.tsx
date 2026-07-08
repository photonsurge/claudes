"use client";

/**
 * One cut on the /admin/runs/:id timeline: when it aired, what kind of shot,
 * which subject (event / country / alert / globe view), how long it really
 * held vs. the plan, and the sub-views (round-up tour stops) inside the shot.
 * Click toggles the raw detail rows (severity, depth, camera…).
 */
import Link from "next/link";
import { useState } from "react";
import { fmtDuration, kindColor, type AirEntry } from "../../lib/airlog";

const timeOf = (iso: string): string => new Date(iso).toISOString().slice(11, 19);

/** The subject part of "kind:subject" ids; storm ids link to the alert page. */
function subjectOf(e: AirEntry): { label: string; href?: string } {
  const label = e.segmentId.includes(":") ? e.segmentId.slice(e.segmentId.indexOf(":") + 1) : e.segmentId;
  if (e.kind === "storm") return { label, href: `/admin/alerts/${encodeURIComponent(label)}` };
  return { label };
}

export default function RunTimelineEntry({ entry, isLast }: { entry: AirEntry; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const color = kindColor(entry.kind);
  const subject = subjectOf(entry);
  const cutShort = entry.endReason === "skipped";
  const onAirNow = !entry.endedAt && !entry.endReason;

  return (
    <div style={{ display: "flex", gap: 14 }}>
      {/* Rail: air time, kind-coloured dot, connector down to the next cut. */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 74, flexShrink: 0 }}>
        <div style={{ color: "#8b95a7", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{timeOf(entry.startedAt)}</div>
        <div style={{ width: 11, height: 11, borderRadius: "50%", background: color, marginTop: 4, flexShrink: 0 }} />
        {!isLast && <div style={{ width: 2, flex: 1, background: "#1b2030", marginTop: 4 }} />}
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          marginBottom: 14,
          padding: "10px 14px",
          borderRadius: 8,
          border: `1px solid ${onAirNow ? "#7f1d1d" : "#1b2030"}`,
          background: "#0c111c",
          cursor: entry.details?.length ? "pointer" : "default",
        }}
        onClick={() => entry.details?.length && setOpen(!open)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ padding: "1px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700, color, border: `1px solid ${color}55` }}>
            #{entry.seq} {entry.kind}
          </span>
          <span style={{ fontWeight: 600 }}>
            {entry.icon ? `${entry.icon} ` : ""}
            {entry.title}
          </span>
          {entry.breaking && (
            <span title="Aired via the breaking-news priority tier" style={{ ...miniBadge, color: "#fbbf24", borderColor: "#fbbf2455" }}>
              ⚡ breaking
            </span>
          )}
          {entry.timesShown > 1 && (
            <span title="Nth airing of this segment in the session" style={miniBadge}>
              ×{entry.timesShown}
            </span>
          )}
          {onAirNow && <span style={{ ...miniBadge, color: "#f87171", borderColor: "#f8717155" }}>● on air</span>}
        </div>

        {entry.subtitle && <div style={{ color: "#8b95a7", fontSize: 12, marginTop: 3 }}>{entry.subtitle}</div>}

        <div style={{ display: "flex", gap: 14, marginTop: 6, color: "#5b6478", fontSize: 12, flexWrap: "wrap" }}>
          <span>
            {entry.actualMs != null ? fmtDuration(entry.actualMs) : "…"} of {fmtDuration(entry.holdMs)}
            {cutShort && <span style={{ color: "#fca5a5" }}> · skipped early</span>}
          </span>
          <span>
            @ {entry.center[1].toFixed(1)}, {entry.center[0].toFixed(1)} · z{entry.zoom.toFixed(1)}
          </span>
          <span>
            {subject.href ? (
              <Link href={subject.href} style={{ color: "#60a5fa" }} onClick={(ev) => ev.stopPropagation()}>
                {subject.label}
              </Link>
            ) : (
              subject.label
            )}
          </span>
          {entry.adId && <span>ad {entry.adId}</span>}
        </div>

        {/* Sub-views: the camera stops this shot toured through, in order. */}
        {!!entry.stops?.length && (
          <div style={{ marginTop: 8, borderLeft: "2px solid #1b2030", paddingLeft: 10 }}>
            {entry.stops.map((s, i) => (
              <div key={i} style={{ color: "#8b95a7", fontSize: 12, padding: "2px 0" }}>
                ↳ {s.label}
                {s.subtitle ? <span style={{ color: "#5b6478" }}> · {s.subtitle}</span> : null}
                <span style={{ color: "#3a4152" }}>
                  {" "}
                  ({s.lat.toFixed(1)}, {s.lng.toFixed(1)})
                </span>
              </div>
            ))}
          </div>
        )}

        {open && !!entry.details?.length && (
          <table style={{ marginTop: 8, fontSize: 12, borderCollapse: "collapse" }}>
            <tbody>
              {entry.details.map((d, i) => (
                <tr key={i}>
                  <td style={{ color: "#5b6478", padding: "2px 14px 2px 0", whiteSpace: "nowrap" }}>{d.label}</td>
                  <td style={{ color: "#cbd5e1", padding: "2px 0" }}>{d.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const miniBadge: React.CSSProperties = {
  padding: "1px 7px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  color: "#8b95a7",
  border: "1px solid #2a3344",
};
