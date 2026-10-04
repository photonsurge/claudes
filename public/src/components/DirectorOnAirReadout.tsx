"use client";

/** The "ON AIR · Ns" readout — current shot title/subtitle + what's up next.
 *  Ticks its own countdown; renders nothing while auto is off or the director
 *  hasn't cut to a first shot yet. */
import { useEffect, useState } from "react";
import { upNextLabel, type DirectorState } from "@photonsurge/shared/director";
import { box } from "./panelBox";

export default function DirectorOnAirReadout({ auto, live }: { auto: boolean; live: DirectorState | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  if (!auto) return null;
  if (!live?.segment) return <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>Starting up…</div>;

  const remaining = live.endsAt ? Math.max(0, Math.round((live.endsAt - now) / 1000)) : 0;
  const status = live.paused
    ? `ON AIR · PAUSED${live.paused.until ? ` · resumes in ${Math.max(0, Math.round((live.paused.until - now) / 1000))}s` : ""}`
    : `ON AIR · ${remaining}s`;
  return (
    <div style={{ ...box, marginBottom: 12, padding: 10, borderColor: "#3a4a66" }}>
      <div style={{ fontSize: 11, color: live.paused ? "#ffb454" : "#ff6a6a", fontWeight: 700, letterSpacing: 1 }}>{status}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{live.segment.title}</div>
      {live.segment.subtitle ? <div style={{ fontSize: 12, opacity: 0.8 }}>{live.segment.subtitle}</div> : null}
      {live.upNext.length ? (
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
          {live.upNext.map((u, i) => (
            <div key={i}>
              {i === 0 ? "Up next: " : ""}
              {upNextLabel(u)}
            </div>
          ))}
        </div>
      ) : null}
      {live.queued?.length ? (
        <div style={{ fontSize: 11, color: "#7fb3ff", marginTop: 6 }} aria-label="Command queue">
          {live.queued.map((q, i) => (
            <div key={q.id}>
              {i === 0 ? "Queued: " : ""}
              {q.label}
              {q.source === "viewer" ? " (viewer)" : ""}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
