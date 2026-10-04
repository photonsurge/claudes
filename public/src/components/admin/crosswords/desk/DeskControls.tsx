"use client";

/**
 * The Desk's game controls: Pause/Resume, Skip clue, Reveal word, Next puzzle.
 * Each queues a `crossword.inject` command; the runner applies it on its next
 * tick and the board shows the result on the following poll. Next puzzle
 * abandons the one on air, so it asks first.
 */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import type { CrosswordCommand, CrosswordPublicState } from "@photonsurge/shared/crossword";
import { sendCommand } from "../puzzles/api";

interface Props {
  sceneId: string;
  state: CrosswordPublicState | null;
  /** Called after a command is queued (the page polls sooner). */
  onSent?: () => void;
  /** Injectable for tests. */
  send?: typeof sendCommand;
  confirmNext?: (message: string) => boolean;
}

export default function DeskControls({ sceneId, state, onSent, send = sendCommand, confirmNext = (m) => window.confirm(m) }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (command: CrosswordCommand) => {
    setBusy(true);
    setError(null);
    const res = await send(sceneId, command);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onSent?.();
  };

  const playing = state?.phase === "playing" && !!state.spotlight;
  const paused = !!state?.paused;

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
        <Button variant={paused ? "contained" : "outlined"} disabled={busy || !state} onClick={() => run(paused ? "resume" : "pause")}>
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button variant="outlined" disabled={busy || !playing} onClick={() => run("skipClue")}>
          Skip clue
        </Button>
        <Button variant="outlined" disabled={busy || !playing} onClick={() => run("reveal")}>
          Reveal word
        </Button>
        <Button
          variant="outlined"
          color="warning"
          disabled={busy || !state}
          onClick={() => {
            if (confirmNext("Finish this puzzle now and start the next one?")) run("nextPuzzle");
          }}
        >
          Next puzzle
        </Button>
      </Stack>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Stack>
  );
}
