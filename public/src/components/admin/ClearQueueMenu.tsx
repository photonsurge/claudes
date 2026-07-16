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
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { font, surface } from "../../theme/tokens";

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
    <Box ref={wrap} component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1, position: "relative" }}>
      {note && (
        <Typography variant="caption" color={note.startsWith("failed") ? "error.main" : "text.secondary"}>
          {note}
        </Typography>
      )}

      {/* Split button: the pair reads as one control, so the shared edge is squared off. */}
      <Box sx={{ display: "inline-flex" }}>
        <Button
          variant="outlined"
          color="error"
          disabled={off || all === 0}
          onClick={() => clear()}
          title="Remove every job in every state. Schedules survive; a running job finishes."
          sx={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: "none" }}
        >
          {busy ? "Clearing…" : `Clear queue${all ? ` (${all})` : ""}`}
        </Button>
        <Button
          variant="outlined"
          color="error"
          disabled={off}
          aria-label="Clear one state"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          sx={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, minWidth: 0, px: 1 }}
        >
          ▾
        </Button>
      </Box>

      {/*
        A hand-rolled popover rather than MUI's Menu: this closes on a
        document-level Escape/outside-click (see the effect above), which the
        Modal-based Menu doesn't fire, and the items must stay native <button>s
        so `disabled` is the real attribute and not just aria-disabled.
      */}
      {open && (
        <Paper
          role="menu"
          sx={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, minWidth: 180, p: 0.5 }}
        >
          <Typography variant="overline" color="text.disabled" sx={{ display: "block", px: 1.25, pt: 0.75, pb: 0.5 }}>
            Clear one state
          </Typography>
          {CLEARABLE_STATES.map((s) => {
            const n = counts?.[s] ?? 0;
            return (
              <Box
                key={s}
                component="button"
                type="button"
                role="menuitem"
                disabled={n === 0}
                onClick={() => clear([s])}
                sx={{
                  display: "flex",
                  width: "100%",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1.5,
                  px: 1.25,
                  py: 0.875,
                  borderRadius: 1,
                  border: "none",
                  bgcolor: "transparent",
                  font: "inherit",
                  fontSize: 13,
                  textAlign: "left",
                  color: n === 0 ? "text.disabled" : "text.primary",
                  cursor: n === 0 ? "default" : "pointer",
                  "&:not(:disabled):hover": { bgcolor: surface.raised },
                }}
              >
                <Box component="span">{s}</Box>
                <Box component="span" sx={{ color: "text.disabled", fontWeight: 600, fontFamily: font.mono, fontVariantNumeric: "tabular-nums" }}>
                  {n}
                </Box>
              </Box>
            );
          })}
        </Paper>
      )}
    </Box>
  );
}
