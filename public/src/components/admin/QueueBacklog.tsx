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
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { font, surface } from "../../theme/tokens";

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
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", py: 1 }}>
        Nothing queued.
      </Typography>
    );
  }

  const total = rows.reduce((n, r) => n + r.count, 0);

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        {total} queued across {rows.length} job {rows.length === 1 ? "kind" : "kinds"} — biggest first.
        Cancelling removes every one that hasn&apos;t started; a running job finishes, and the
        schedule re-arms as normal.
      </Typography>

      <Stack spacing={0.5}>
        {rows.map((r) => {
          const key = `${r.type}.${r.event}`;
          const isConfirming = confirming === key;
          return (
            <Stack
              key={key}
              direction="row"
              spacing={1.25}
              sx={{
                alignItems: "center",
                px: 1.25,
                py: 0.75,
                borderRadius: 1,
                bgcolor: surface.raised,
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              {/* A pile ≥20 deep is the one worth looking at, so the count carries it. */}
              <Typography
                variant="body2"
                color={r.count >= 20 ? "warning.main" : "text.primary"}
                sx={{ minWidth: 34, textAlign: "right", fontWeight: 600, fontFamily: font.mono, fontVariantNumeric: "tabular-nums" }}
              >
                {r.count}
              </Typography>
              <Typography variant="body2" sx={{ flex: 1, fontFamily: font.mono }}>
                {key}
              </Typography>
              <Typography variant="caption" color="text.secondary" title="age of the oldest one waiting" sx={{ fontVariantNumeric: "tabular-nums" }}>
                oldest {age(r.oldest, now)}
              </Typography>

              {isConfirming ? (
                <>
                  <Button
                    variant="outlined"
                    color="error"
                    disabled={busy}
                    onClick={() => {
                      onCancel(r.type, r.event);
                      setConfirming(null);
                    }}
                  >
                    Cancel {r.count}?
                  </Button>
                  <Button variant="outlined" onClick={() => setConfirming(null)}>
                    No
                  </Button>
                </>
              ) : (
                <Button variant="outlined" disabled={busy} onClick={() => setConfirming(key)}>
                  Cancel
                </Button>
              )}
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}
