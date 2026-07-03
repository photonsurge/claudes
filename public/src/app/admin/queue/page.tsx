"use client";

/**
 * /admin/queue — a BullMQ dashboard for the single worker queue. Browse jobs by
 * state, inspect payload / failure / return value, retry·remove·promote them,
 * pause/resume the queue, and see the repeatable schedules the worker registers.
 * All queue access is server-side via /api/admin/queue (getQueue → Redis).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import QueueJob, { type SerializedJob, type JobAction } from "../../../components/admin/QueueJob";

const STATES = ["active", "waiting", "prioritized", "delayed", "failed", "completed", "paused"] as const;
type State = (typeof STATES)[number];

interface Repeatable {
  key: string;
  id: string | null;
  label: string;
  pattern: string | null;
  every: string | number | null;
  next: number | null;
  tz: string | null;
}

interface QueueData {
  queue: string;
  state: State;
  counts: Record<string, number> | null;
  paused: boolean;
  jobs: SerializedJob[];
  repeatables: Repeatable[];
  limit: number;
  error?: string;
}

const STATE_COLOR: Record<State, string> = {
  active: "#60a5fa",
  waiting: "#fbbf24",
  prioritized: "#fbbf24",
  delayed: "#a78bfa",
  failed: "#f87171",
  completed: "#4ade80",
  paused: "#8b95a7",
};

function fmtEvery(r: Repeatable): string {
  if (r.pattern) return `cron ${r.pattern}`;
  const ms = Number(r.every);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 60_000) return `every ${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `every ${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `every ${Math.round(ms / 3_600_000)}h`;
  return `every ${Math.round(ms / 86_400_000)}d`;
}

function fmtNext(next: number | null, now: number): string {
  if (!next) return "—";
  const s = Math.round((next - now) / 1000);
  if (s <= 0) return "due";
  if (s < 60) return `in ${s}s`;
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  return `in ${Math.round(s / 3600)}h`;
}

const toolBtn = (bg: string): React.CSSProperties => ({
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #2a3344",
  background: bg,
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
});

export default function QueuePage() {
  const [state, setState] = useState<State>("active");
  const [limit, setLimit] = useState(100);
  const [data, setData] = useState<QueueData | null>(null);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.parse("2026-01-01T00:00:00Z"));
  // Keep the latest state/limit for the polling loop without re-arming it.
  const params = useRef({ state, limit });
  params.current = { state, limit };

  const refresh = useCallback(async () => {
    const { state: s, limit: l } = params.current;
    const res = await fetch(`/api/admin/queue?state=${s}&limit=${l}`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as QueueData | null;
    if (body) setData(body);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    if (!live) return;
    const iv = setInterval(refresh, 4000);
    return () => clearInterval(iv);
  }, [refresh, live, state, limit]);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      await fetch("/api/admin/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const jobAction = (action: JobAction, id: string) => post({ action, id });

  const counts = data?.counts ?? null;
  const total = counts?.[state] ?? 0;
  const jobs = data?.jobs ?? [];

  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 860, margin: "0 auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Queue</h2>
            <div style={{ color: "#5b6577", fontSize: 12, marginTop: 2 }}>
              {data?.queue ?? "…"}
              {data?.paused && <span style={{ color: "#fbbf24", marginLeft: 8 }}>⏸ paused</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => post({ action: data?.paused ? "resume" : "pause" })}
              style={toolBtn(data?.paused ? "#14532d" : "#3a2a10")}
            >
              {data?.paused ? "Resume queue" : "Pause queue"}
            </button>
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              style={toolBtn(live ? "#14532d" : "#1a1f2b")}
              title="Auto-refresh every 4s"
            >
              {live ? "● live" : "paused"}
            </button>
          </div>
        </div>

        {data?.error && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 8, border: "1px solid #3a1620", background: "#1a0d12", color: "#fca5a5", fontSize: 13 }}>
            Queue unreachable (worker / Redis down?) — {data.error}
          </div>
        )}

        {/* State tabs */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
          {STATES.map((s) => {
            const on = s === state;
            const c = counts?.[s] ?? 0;
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setState(s);
                  setLimit(100);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "6px 12px",
                  borderRadius: 7,
                  cursor: "pointer",
                  border: `1px solid ${on ? STATE_COLOR[s] : "#1b2030"}`,
                  background: on ? "#0c111c" : "transparent",
                  color: on ? "#fff" : "#8b95a7",
                  fontSize: 13,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATE_COLOR[s] }} />
                {s}
                <span style={{ color: on ? STATE_COLOR[s] : "#5b6577", fontWeight: 600 }}>{c}</span>
              </button>
            );
          })}
        </div>

        {/* Per-state bulk actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 14, minHeight: 30, alignItems: "center", flexWrap: "wrap" }}>
          {state === "failed" && total > 0 && (
            <>
              <button type="button" disabled={busy} onClick={() => post({ action: "retryAll" })} style={toolBtn("#2563eb")}>
                Retry all ({total})
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => confirm(`Delete all ${total} failed jobs?`) && post({ action: "clean", type: "failed" })}
                style={toolBtn("#3a1620")}
              >
                Clean failed
              </button>
            </>
          )}
          {state === "completed" && total > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => confirm(`Delete all ${total} completed jobs?`) && post({ action: "clean", type: "completed" })}
              style={toolBtn("#3a1620")}
            >
              Clean completed
            </button>
          )}
          <span style={{ color: "#5b6577", fontSize: 12, marginLeft: "auto" }}>
            showing {jobs.length} of {total}
          </span>
        </div>

        {/* Jobs */}
        <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
          {jobs.map((j) => (
            <QueueJob key={j.id} job={j} state={state} now={now} busy={busy} onAction={jobAction} />
          ))}
          {jobs.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "#5b6577", border: "1px dashed #1b2030", borderRadius: 8 }}>
              No {state} jobs.
            </div>
          )}
        </div>

        {jobs.length < total && (
          <button
            type="button"
            onClick={() => setLimit((l) => l + 200)}
            style={{ ...toolBtn("#1a1f2b"), width: "100%", marginTop: 10, padding: 10 }}
          >
            Load more ({total - jobs.length} more)
          </button>
        )}

        {/* Repeatable schedules */}
        <h3 style={{ margin: "32px 0 10px", fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "#8b95a7" }}>
          Repeatable schedules {data?.repeatables?.length ? `(${data.repeatables.length})` : ""}
        </h3>
        <div style={{ border: "1px solid #1b2030", borderRadius: 8, overflow: "hidden" }}>
          {(data?.repeatables ?? []).map((r) => (
            <div
              key={r.key}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 14px", borderTop: "1px solid #121826", fontSize: 13 }}
            >
              <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                <span style={{ fontWeight: 600 }}>{r.label}</span>
                {r.id && r.id !== r.label && (
                  <span style={{ color: "#5b6577", fontSize: 11, marginLeft: 8, fontFamily: "ui-monospace, monospace" }}>{r.id}</span>
                )}
              </span>
              <span style={{ color: "#8b95a7", whiteSpace: "nowrap" }}>{fmtEvery(r)}</span>
              <span style={{ color: "#64748b", whiteSpace: "nowrap", width: 60, textAlign: "right" }}>{fmtNext(r.next, now)}</span>
            </div>
          ))}
          {(data?.repeatables?.length ?? 0) === 0 && (
            <div style={{ padding: 14, color: "#5b6577", fontSize: 13 }}>No repeatable schedules registered.</div>
          )}
        </div>
      </section>
    </main>
  );
}
