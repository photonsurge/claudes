"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { font, surface } from "../../theme/tokens";

/** One BullMQ job flattened by /api/admin/queue. */
export interface SerializedJob {
  id: string;
  name: string;
  domain: string | null;
  /** Server-built name, source-qualified where relevant ("alerts.ingest:wmo").
   *  Distinct from TriggerableJob.label, which is the operator-facing "Check
   *  weather run" — same admin page, different meaning, so different key. */
  displayName?: string | null;
  type: string | null;
  event: string | null;
  payload: unknown;
  attemptsMade: number;
  maxAttempts: number;
  timestamp: number | null;
  processedOn: number | null;
  finishedOn: number | null;
  delay: number;
  progress: number;
  priority: number | null;
  failedReason: string | null;
  stacktrace: string[];
  returnvalue: unknown;
  repeatJobKey: string | null;
  /** Which queue tier this job ran on (foreground/mid/background). */
  tier?: string | null;
}

export type JobAction = "retry" | "remove" | "promote" | "cancel";

// States where a job hasn't finished — "Cancel" (stop it) is the right verb.
// Terminal records (failed/completed) get "Remove" (delete the record) instead.
const CANCELLABLE = new Set(["active", "waiting", "prioritized", "delayed", "paused"]);

function relTime(ms: number | null, now: number): string {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** The timestamp that best characterises a job in a given state. */
function stamp(job: SerializedJob, state: string, now: number): string {
  if (state === "completed" || state === "failed") return relTime(job.finishedOn, now);
  if (state === "active") return relTime(job.processedOn, now);
  if (state === "delayed") {
    const due = (job.timestamp ?? now) + (job.delay ?? 0);
    const inS = Math.round((due - now) / 1000);
    return inS > 0 ? `in ${inS < 60 ? `${inS}s` : inS < 3600 ? `${Math.round(inS / 60)}m` : `${Math.round(inS / 3600)}h`}` : "due";
  }
  return relTime(job.timestamp, now);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="overline" color="text.disabled" sx={{ display: "block", fontSize: 10, letterSpacing: 0.5, mb: 0.375 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.25,
        borderRadius: 1,
        bgcolor: surface.sunken,
        border: "1px solid",
        borderColor: "divider",
        color: "text.secondary",
        fontSize: 11.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxHeight: 260,
        overflow: "auto",
      }}
    >
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </Box>
  );
}

export default function QueueJob({
  job,
  state,
  now,
  busy,
  onAction,
}: {
  job: SerializedJob;
  state: string;
  now: number;
  busy: boolean;
  onAction: (action: JobAction, id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Prefer the server's qualified label ("alerts.ingest:wmo") — alerts runs one
  // repeatable per source, so an unqualified name shows four identical rows.
  const label = job.displayName || (job.type && job.event ? `${job.type}.${job.event}` : job.name || "job");
  const hasBody = job.payload != null && Object.keys(job.payload as object).length > 0;

  return (
    <Paper>
      <Stack
        direction="row"
        spacing={1.5}
        onClick={() => setOpen((v) => !v)}
        sx={{ alignItems: "center", px: 1.75, py: 1.375, cursor: "pointer" }}
      >
        <Box component="span" sx={{ color: "text.disabled", width: 14 }}>
          {open ? "▾" : "▸"}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {label}
            </Typography>
            <Typography variant="caption" color="text.disabled" sx={{ fontFamily: font.mono }}>
              #{job.id}
            </Typography>
            {job.tier && (
              // Which lane it ran on — background is the memory-capped one, flagged.
              <Typography
                variant="caption"
                sx={{
                  px: 0.6,
                  borderRadius: 0.5,
                  fontWeight: 600,
                  bgcolor: job.tier === "background" ? "warning.dark" : job.tier === "foreground" ? "info.dark" : "action.selected",
                  color: job.tier === "mid" ? "text.secondary" : "common.white",
                }}
              >
                {job.tier}
              </Typography>
            )}
            {job.attemptsMade > 0 && (
              <Typography variant="caption" color={job.failedReason ? "error.main" : "text.secondary"}>
                attempt {job.attemptsMade}/{job.maxAttempts}
              </Typography>
            )}
            {job.priority ? (
              <Typography variant="caption" color="text.secondary">
                prio {job.priority}
              </Typography>
            ) : null}
          </Stack>
          {job.failedReason && (
            <Typography
              variant="caption"
              color="error.main"
              sx={{ display: "block", mt: 0.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {job.failedReason}
            </Typography>
          )}
          {state === "active" && job.progress > 0 && (
            <LinearProgress
              variant="determinate"
              value={Math.min(100, job.progress)}
              sx={{ height: 3, borderRadius: 1, mt: 0.75, bgcolor: surface.raised }}
            />
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          {stamp(job, state, now)}
        </Typography>
      </Stack>

      {open && (
        <Box sx={{ pt: 0, pr: 1.75, pb: 1.75, pl: 5, borderTop: "1px solid", borderColor: "divider" }}>
          {job.repeatJobKey && (
            <Field label="repeatable">
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: font.mono }}>
                {job.repeatJobKey}
              </Typography>
            </Field>
          )}
          {hasBody && (
            <Field label="data">
              <Json value={job.payload} />
            </Field>
          )}
          {job.failedReason && (
            <Field label={`failed reason (${job.stacktrace.length} stack frames)`}>
              <Json value={job.stacktrace.length ? job.stacktrace.join("\n\n") : job.failedReason} />
            </Field>
          )}
          {job.returnvalue != null && (
            <Field label="return value">
              <Json value={job.returnvalue} />
            </Field>
          )}

          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            {state === "failed" && (
              <Button variant="outlined" disabled={busy} onClick={() => onAction("retry", job.id)}>
                Retry
              </Button>
            )}
            {state === "delayed" && (
              <Button variant="outlined" disabled={busy} onClick={() => onAction("promote", job.id)}>
                Promote
              </Button>
            )}
            {CANCELLABLE.has(state) ? (
              <Button
                variant="outlined"
                color="error"
                disabled={busy}
                onClick={() => onAction("cancel", job.id)}
                title={state === "active" ? "Signal the worker to abort this running job (cooperative)" : "Remove this job before it runs"}
              >
                Cancel
              </Button>
            ) : (
              <Button variant="outlined" color="error" disabled={busy} onClick={() => onAction("remove", job.id)}>
                Remove
              </Button>
            )}
          </Stack>
        </Box>
      )}
    </Paper>
  );
}
