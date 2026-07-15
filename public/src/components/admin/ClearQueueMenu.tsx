"use client";

/**
 * "Clear queue" — the shared destructive control on /admin/queue and
 * /admin/jobs. The button purges everything; the ▾ opens a menu to purge one
 * state at a time (just the failed pile, just completed, …). Both POST
 * { action: "clear", states? } to /api/admin/queue → shared clearQueue().
 *
 * Two caveats the confirm text spells out, because both surprise operators:
 * clearing a queued/delayed job that a repeatable schedule has armed means
 * dropping that schedule (BullMQ won't remove the job otherwise), and the worker
 * only re-registers schedules at boot — so a clear can need a worker restart to
 * put them back. A job already running can't be preempted either: it finishes,
 * only its record goes.
 */
import { useEffect, useRef, useState } from "react";

// The selectable states, named as getJobCounts reports them (clearQueue folds
// "waiting" onto BullMQ's internal "wait"). Order matches the queue dashboard's
// tabs so the two read the same.
export const CLEARABLE_STATES = [
  "active",
  "waiting",
  "prioritized",
  "delayed",
  "failed",
  "completed",
  "paused",
] as const;

export type ClearableState = (typeof CLEARABLE_STATES)[number];

interface ClearQueueMenuProps {
  /** Per-state job counts from getJobCounts, for the totals shown per row. */
  counts: Record<string, number> | null;
  /** Called after a clear so the caller can re-poll. */
  onDone?: () => void;
  /** Disable while a sibling control is mid-flight. */
  disabled?: boolean;
}

const btn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #3a1620",
  background: "#3a1620",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
};

function total(counts: Record<string, number> | null): number {
  if (!counts) return 0;
  return CLEARABLE_STATES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
}

export default function ClearQueueMenu({ counts, onDone, disabled }: ClearQueueMenuProps) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const all = total(counts);
  const off = busy || disabled;

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** `states` undefined → clear everything. */
  const clear = async (states?: ClearableState[]) => {
    const n = states ? (counts?.[states[0]] ?? 0) : all;
    const what = states ? `all ${n} ${states[0]} job${n === 1 ? "" : "s"}` : `all ${n} job${n === 1 ? "" : "s"} in every state`;
    const ok = confirm(
      `Clear ${what}?\n\n` +
        `Any repeatable schedule holding one of these jobs is dropped to remove it — BullMQ won't delete an armed job otherwise. ` +
        `Those schedules stop firing until you restart the worker, which re-registers them all.\n\n` +
        `A job that is already running still finishes.`,
    );
    if (!ok) return;
    setOpen(false);
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear", ...(states ? { states } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (body?.ok) {
        const removed = Object.values((body.detail?.removed ?? {}) as Record<string, number>).reduce(
          (a, b) => a + b,
          0,
        );
        const dropped = Number(body.detail?.schedulers ?? 0);
        // Dropped schedules are the thing an operator must act on — they don't
        // come back without a worker restart — so they get said, not buried.
        setNote(
          dropped
            ? `cleared ${removed} · ${dropped} schedule${dropped === 1 ? "" : "s"} dropped — restart the worker`
            : `cleared ${removed}`,
        );
      } else {
        setNote(`failed: ${body?.error ?? res.status}`);
      }
      onDone?.();
    } catch (err) {
      setNote(`failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span ref={wrap} style={{ display: "inline-flex", alignItems: "center", gap: 8, position: "relative" }}>
      {note && <span style={{ fontSize: 11, color: note.startsWith("failed") ? "#fca5a5" : "#8b95a7" }}>{note}</span>}

      <span style={{ display: "inline-flex" }}>
        <button
          type="button"
          disabled={off || all === 0}
          onClick={() => clear()}
          title="Remove every job in every state. Schedules survive; a running job finishes."
          style={{
            ...btn,
            borderRadius: "6px 0 0 6px",
            borderRight: "none",
            opacity: off || all === 0 ? 0.5 : 1,
          }}
        >
          {busy ? "Clearing…" : `Clear queue${all ? ` (${all})` : ""}`}
        </button>
        <button
          type="button"
          disabled={off}
          aria-label="Clear one state"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{ ...btn, borderRadius: "0 6px 6px 0", padding: "6px 8px", opacity: off ? 0.5 : 1 }}
        >
          ▾
        </button>
      </span>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 20,
            minWidth: 180,
            padding: 4,
            borderRadius: 8,
            border: "1px solid #2a3344",
            background: "#0c111c",
            boxShadow: "0 8px 24px rgba(0,0,0,.5)",
          }}
        >
          <div style={{ padding: "6px 10px 4px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#5b6577" }}>
            Clear one state
          </div>
          {CLEARABLE_STATES.map((s) => {
            const n = counts?.[s] ?? 0;
            return (
              <button
                key={s}
                type="button"
                role="menuitem"
                disabled={n === 0}
                onClick={() => clear([s])}
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: n === 0 ? "#5b6577" : "#dfe7f5",
                  cursor: n === 0 ? "default" : "pointer",
                  fontSize: 13,
                  textAlign: "left",
                }}
              >
                <span>{s}</span>
                <span style={{ color: "#5b6577", fontWeight: 600 }}>{n}</span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
