"use client";

/**
 * The Desk's End: stops this channel's live run through the Streams API
 * (POST /api/streams/:id/stop, the worker does the rest). The live run comes
 * from GET /api/streams, polled; with none, the button is disabled and says so.
 */
import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import { runIsActive, type RunState } from "@photonsurge/shared/runs";
import { stopStream } from "../../../../lib/stream";

/** GET /api/streams lists every run, so this polls slowly; there is no per-channel route. */
export const END_POLL_MS = 15_000;

interface Props {
  sceneId: string;
  /** Injectable for tests. */
  stop?: (runId: string) => Promise<{ slotDisabled?: string }>;
  confirmEnd?: (message: string) => boolean;
}

export default function EndButton({ sceneId, stop = stopStream, confirmEnd = (m) => window.confirm(m) }: Props) {
  const [run, setRun] = useState<RunState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/streams", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { runs?: RunState[] };
      setRun(body.runs?.find((r) => r.sceneId === sceneId && runIsActive(r.status)) ?? null);
    } catch {
      /* keep the last known run */
    }
  }, [sceneId]);

  useEffect(() => {
    load();
    const t = setInterval(load, END_POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const end = async () => {
    if (!run) return;
    const slotNote = run.slotId ? " This run belongs to the channel's standing slot, so this also turns the slot off, or it would be restarted." : "";
    if (!confirmEnd(`End the live stream for this channel? The broadcast is completed on YouTube.${slotNote}`)) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await stop(run.id);
      setDone(`Stop requested. The stream is ending.${res?.slotDisabled ? ` The standing slot ${res.slotDisabled} is now off.` : ""}`);
      setTimeout(load, 1500);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
    setBusy(false);
  };

  return (
    <Stack spacing={1}>
      <Tooltip title={run ? "" : "This channel has no live run"}>
        <span>
          <Button variant="outlined" color="error" disabled={busy || !run} onClick={end}>
            End
          </Button>
        </span>
      </Tooltip>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {done && (
        <Alert severity="success" onClose={() => setDone(null)}>
          {done}
        </Alert>
      )}
    </Stack>
  );
}
