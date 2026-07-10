"use client";

/** The operator's live "recently aired" glance — the last few shots this scene
 *  cut, read from the DURABLE as-run log (the same AirEntry source /admin/runs
 *  reads) via GET /api/director/:scene/recent. This survives page reloads and
 *  never misses a cut, unlike the old client-only tracker that only logged the
 *  cuts it happened to witness while the panel was open.
 *
 *  Shown in place of the setup form while auto is running (toggle back with
 *  "⚙ Settings"). Refetches on each cut (live.seq changes) plus a slow safety
 *  poll — the worker writes the entry a beat after it emits the socket cut, so
 *  a refetch that races the persist is caught by the next tick. */
import { useCallback, useEffect, useState } from "react";
import type { DirectorState, SegmentKind } from "@photonsurge/shared/director";
import { KIND_LABEL } from "./DirectorHolds";

/** One aired shot from the as-run log (the subset this glance renders). */
interface RecentEntry {
  seq: number;
  segmentId: string;
  kind: SegmentKind;
  title: string;
  startedAt: string;
  endedAt?: string;
}

/** Compact "how long ago" — seconds/minutes only, this is a recent-history
 *  glance, not a durable timestamped record. */
function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

export default function DirectorRecentlyAired({
  sceneId,
  live,
  visible,
}: {
  sceneId: string;
  live: DirectorState | null;
  visible: boolean;
}) {
  const [entries, setEntries] = useState<RecentEntry[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/director/${encodeURIComponent(sceneId)}/recent?limit=10`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { entries?: RecentEntry[] };
      if (Array.isArray(json.entries)) setEntries(json.entries);
    } catch {
      /* transient network/parse error — keep the last good list */
    }
  }, [sceneId]);

  // Refetch when shown and on every cut (seq change); a cut whose log write
  // lands just after the socket emit is picked up by the slow poll below.
  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, live?.seq, load]);

  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [visible, load]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [visible]);

  if (!visible) return null;

  // "Recently aired" = shots already off the screen. The on-air shot is shown
  // above (DirectorOnAirReadout), so drop the entry the director is currently
  // holding. `seq` resets per run, so match segmentId too — otherwise an older
  // run's same-seq entry (or a dangling open one from a crashed session) would
  // be hidden by mistake. Entries arrive newest-first.
  const onAirId = live?.active ? live.segment?.id : undefined;
  const past = entries.filter((e) => !(onAirId && e.seq === live?.seq && e.segmentId === onAirId));

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 12, opacity: 0.8 }}>Recently aired:</span>
        {/* The full as-run history: /admin/runs lists every session (click a
            row there for its cut-by-cut timeline). New tab so the operator
            doesn't lose /control mid-show. */}
        <a
          href="/admin/runs"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 11, color: "#60a5fa", textDecoration: "none" }}
        >
          Full log ↗
        </a>
      </div>
      {past.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {past.map((h) => (
            <div
              key={`${h.seq}-${h.startedAt}`}
              style={{ fontSize: 12, opacity: 0.75, display: "flex", justifyContent: "space-between", gap: 8 }}
            >
              <span>
                {KIND_LABEL[h.kind]} · {h.title}
              </span>
              <span style={{ opacity: 0.6, whiteSpace: "nowrap" }}>
                {agoLabel(now - new Date(h.endedAt ?? h.startedAt).getTime())}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.5 }}>Nothing aired yet this session.</div>
      )}
    </div>
  );
}
