"use client";

/**
 * /admin/runs/:id — one as-run session reviewed shot by shot: a vertical
 * timeline of every cut the director made (kind, subject, real vs. planned
 * hold, breaking/skip marks, and the sub-view stops inside round-up shots).
 * Re-polls while the session is live so the timeline grows as the show airs.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import RunTimelineEntry from "../../../../components/admin/RunTimelineEntry";
import {
  fmtDuration,
  getRun,
  kindColor,
  runDurationMs,
  runIsLive,
  type AirEntry,
  type AirRun,
} from "../../../../lib/airlog";

const POLL_MS = 5_000;

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<AirRun | null>(null);
  const [entries, setEntries] = useState<AirEntry[]>([]);
  const [sceneName, setSceneName] = useState("");
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    const res = await getRun(id);
    if (!res) {
      setMissing(true);
      return;
    }
    setRun(res.run);
    setEntries(res.entries);
    setSceneName(res.sceneName);
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const live = run ? runIsLive(run) : false;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [live, reload]);

  return (
    <AdminPageShell
      title={run ? `Run · ${sceneName}` : "Run"}
      crumbs={[{ href: "/admin/runs", label: "Runs" }, { label: run ? fmtTime(run.startedAt) : "…" }]}
      description={
        run ? (
          <>
            {live ? <span style={{ color: "#f87171", fontWeight: 700 }}>● LIVE · </span> : null}
            {fmtTime(run.startedAt)} → {run.endedAt ? fmtTime(run.endedAt) : "now"} ·{" "}
            {fmtDuration(runDurationMs(run))} · {run.cuts} cuts
            {run.endReason === "stale" ? " · orphaned (worker restarted mid-session)" : ""}
          </>
        ) : missing ? (
          "No such run."
        ) : (
          "Loading…"
        )
      }
      actions={
        <button type="button" onClick={reload} style={primary}>
          Refresh
        </button>
      }
    >
      {run && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
          {Object.entries(run.kindCounts ?? {})
            .sort((a, b) => b[1] - a[1])
            .map(([kind, n]) => (
              <span
                key={kind}
                style={{
                  padding: "2px 9px",
                  borderRadius: 11,
                  fontSize: 12,
                  fontWeight: 600,
                  color: kindColor(kind),
                  border: `1px solid ${kindColor(kind)}55`,
                  background: "#0c111c",
                }}
              >
                {kind} · {n}
              </span>
            ))}
        </div>
      )}

      <div>
        {entries.map((e, i) => (
          <RunTimelineEntry key={e.id} entry={e} isLast={i === entries.length - 1} />
        ))}
        {run && entries.length === 0 && (
          <div style={{ color: "#8b95a7", fontSize: 13 }}>No cuts recorded in this run yet.</div>
        )}
      </div>
    </AdminPageShell>
  );
}

const primary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
