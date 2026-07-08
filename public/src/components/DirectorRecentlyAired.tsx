"use client";

/** Client-only "what's aired this session" log — a lightweight glance at
 *  recent shots while auto is running, shown in place of the setup form
 *  (toggle back with "⚙ Settings"). Resets on page reload; this isn't a
 *  durable record. Keeps tracking even while hidden (`visible=false`) so
 *  switching to Settings and back doesn't lose history. */
import { useEffect, useRef, useState } from "react";
import type { DirectorState, SegmentKind } from "@photonsurge/shared/director";
import { KIND_LABEL } from "./DirectorHolds";

/** Compact "how long ago" — seconds/minutes only, this is a recent-history
 *  glance, not a durable timestamped record. */
function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

export default function DirectorRecentlyAired({ live, visible }: { live: DirectorState | null; visible: boolean }) {
  const [history, setHistory] = useState<{ kind: SegmentKind; title: string; ts: number }[]>([]);
  const lastLoggedRef = useRef<{ seq: number; kind: SegmentKind; title: string } | null>(null);
  useEffect(() => {
    if (!live?.segment) return;
    const prior = lastLoggedRef.current;
    if (prior && prior.seq !== live.seq) {
      setHistory((h) => [{ kind: prior.kind, title: prior.title, ts: Date.now() }, ...h].slice(0, 10));
    }
    lastLoggedRef.current = { seq: live.seq, kind: live.segment.kind, title: live.segment.title };
  }, [live?.seq, live?.segment]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [visible]);

  if (!visible) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Recently aired:</div>
      {history.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {history.map((h, i) => (
            <div key={i} style={{ fontSize: 12, opacity: 0.75, display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>
                {KIND_LABEL[h.kind]} · {h.title}
              </span>
              <span style={{ opacity: 0.6, whiteSpace: "nowrap" }}>{agoLabel(now - h.ts)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.5 }}>Nothing aired yet this session.</div>
      )}
    </div>
  );
}
