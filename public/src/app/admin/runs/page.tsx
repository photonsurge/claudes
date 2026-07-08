"use client";

/**
 * /admin/runs — the director's as-run sessions. One row per auto-director
 * session (scene entered auto → left auto); click through for the full cut
 * timeline. Live sessions keep updating, so the list re-polls while one is on.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import {
  fmtDuration,
  kindColor,
  listRuns,
  runDurationMs,
  runIsLive,
  type AirRun,
} from "../../../lib/airlog";

const POLL_MS = 10_000;

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

export default function RunsPage() {
  const [runs, setRuns] = useState<AirRun[]>([]);
  const [sceneNames, setSceneNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const res = await listRuns();
    setRuns(res.runs);
    setSceneNames(res.sceneNames);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // A live session grows every cut — keep the list fresh while one is on air.
  const anyLive = runs.some((r) => runIsLive(r));
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [anyLive, reload]);

  return (
    <AdminPageShell
      title="Runs"
      description="What the auto-director actually aired — one session per scene, with the full shot-by-shot timeline inside."
      actions={
        <button type="button" onClick={reload} style={primary}>
          Refresh
        </button>
      }
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#8b95a7" }}>
            <th style={th}>Status</th>
            <th style={th}>Scene</th>
            <th style={th}>Started</th>
            <th style={th}>Duration</th>
            <th style={th}>Cuts</th>
            <th style={th}>Mix</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const live = runIsLive(r);
            return (
              <tr key={r.id} style={{ borderTop: "1px solid #1b2030" }}>
                <td style={td}>
                  {live ? (
                    <span style={liveBadge}>● LIVE</span>
                  ) : (
                    <span style={{ color: "#5b6478", fontSize: 12 }}>
                      {r.endReason === "stale" ? "orphaned" : r.endedAt ? "ended" : "stalled"}
                    </span>
                  )}
                </td>
                <td style={{ ...td, fontWeight: 600 }}>{sceneNames[r.sceneId] ?? r.sceneId}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtTime(r.startedAt)}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDuration(runDurationMs(r))}</td>
                <td style={td}>{r.cuts}</td>
                <td style={td}>
                  <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
                    {Object.entries(r.kindCounts ?? {})
                      .sort((a, b) => b[1] - a[1])
                      .map(([kind, n]) => (
                        <span key={kind} style={{ ...kindChip, color: kindColor(kind), borderColor: `${kindColor(kind)}55` }}>
                          {kind} · {n}
                        </span>
                      ))}
                  </span>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <Link href={`/admin/runs/${r.id}`} style={{ color: "#60a5fa" }}>
                    Timeline →
                  </Link>
                </td>
              </tr>
            );
          })}
          {runs.length === 0 && (
            <tr>
              <td style={td} colSpan={7}>
                {loading
                  ? "Loading…"
                  : "No runs recorded yet. Put the director into auto on /control — the first cut opens a run."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </AdminPageShell>
  );
}

const th: React.CSSProperties = { padding: "8px 10px 8px 0", fontWeight: 600, fontSize: 12 };
const td: React.CSSProperties = { padding: "9px 10px 9px 0", verticalAlign: "top" };
const primary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
const liveBadge: React.CSSProperties = {
  color: "#f87171",
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: 0.5,
};
const kindChip: React.CSSProperties = {
  padding: "1px 7px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  border: "1px solid",
  background: "#0c111c",
};
