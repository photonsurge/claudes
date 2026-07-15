"use client";

/**
 * The backlog, by job kind, with a way to bin a whole kind at once.
 *
 * A queue that's hundreds deep is almost never hundreds of distinct problems —
 * it's a handful of schedules re-firing work that went stale hours ago (a stack
 * of `weather.refresh*` re-runs that a single fresh run would supersede). The job
 * list can't show that: it's newest-first and truncated, so it shows the froth
 * rather than the shape. And cancelling a 200-job pile one row at a time isn't a
 * thing anyone will actually do.
 */
import { useState } from "react";

export interface BacklogRow {
  type: string;
  event: string;
  count: number;
  /** Enqueue time of the oldest of its kind — how far behind this job is. */
  oldest: number | null;
}

const age = (t: number | null, now: number): string => {
  if (!t) return "—";
  const m = Math.round((now - t) / 60_000);
  if (m < 60) return `${m}m`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(1)}h` : `${Math.round(h / 24)}d`;
};

export default function QueueBacklog({
  rows,
  now,
  busy,
  onCancel,
}: {
  rows: BacklogRow[];
  now: number;
  busy: boolean;
  onCancel: (type: string, event: string) => void;
}) {
  // Cancelling is destructive and can't be undone, so make it a two-step: a
  // mis-click on the wrong row shouldn't silently bin 200 jobs.
  const [confirming, setConfirming] = useState<string | null>(null);

  if (!rows.length) {
    return <div style={{ color: "#8b95a7", fontSize: 12, padding: "8px 0" }}>Nothing queued.</div>;
  }

  const total = rows.reduce((n, r) => n + r.count, 0);

  return (
    <div>
      <div style={{ color: "#8b95a7", fontSize: 12, marginBottom: 8 }}>
        {total} queued across {rows.length} job {rows.length === 1 ? "kind" : "kinds"} — biggest first.
        Cancelling removes every one that hasn&apos;t started; a running job finishes, and the
        schedule re-arms as normal.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((r) => {
          const key = `${r.type}.${r.event}`;
          const isConfirming = confirming === key;
          return (
            <div
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 10px",
                borderRadius: 6,
                background: "#131a26",
                border: "1px solid #2a3344",
              }}
            >
              <span
                style={{
                  minWidth: 34,
                  textAlign: "right",
                  color: r.count >= 20 ? "#fbbf24" : "#e6edf7",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                {r.count}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: "#e6edf7" }}>{key}</span>
              <span style={{ color: "#8b95a7", fontSize: 11 }} title="age of the oldest one waiting">
                oldest {age(r.oldest, now)}
              </span>

              {isConfirming ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onCancel(r.type, r.event);
                      setConfirming(null);
                    }}
                    style={btn("#7f1d1d")}
                  >
                    Cancel {r.count}?
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} style={btn("#1b2436")}>
                    No
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(key)}
                  style={btn("#1b2436")}
                >
                  Cancel
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const btn = (bg: string): React.CSSProperties => ({
  padding: "3px 10px",
  borderRadius: 5,
  border: "1px solid #2a3344",
  background: bg,
  color: "#fff",
  cursor: "pointer",
  fontSize: 11,
});
