"use client";

/**
 * The simulator: "say as viewer". The message goes through the same handler
 * as a YouTube chat message (marked `sim`, never written to the chat log), so
 * the whole game can be played before any stream exists. The text clears after
 * each send; the name stays, so one operator can play as one viewer.
 */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { MAX_GUESS_CHARS } from "@photonsurge/shared/crossword";
import { sendSim } from "../puzzles/api";

const NAME_MAX = 40;

interface Props {
  sceneId: string;
  onSent?: () => void;
  /** Injectable for tests. */
  send?: typeof sendSim;
}

export default function SimForm({ sceneId, onSent, send = sendSim }: Props) {
  const [name, setName] = useState("Tester");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const ready = !!name.trim() && !!text.trim();

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const res = await send(sceneId, name.trim(), text.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLast(`${name.trim()}: ${text.trim()}`);
    setText("");
    onSent?.();
  };

  return (
    <Stack spacing={1}>
      <Stack
        component="form"
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          size="small"
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          slotProps={{ htmlInput: { maxLength: NAME_MAX } }}
          sx={{ width: { sm: 160 } }}
        />
        <TextField
          size="small"
          label="Message"
          placeholder="7a crater"
          value={text}
          onChange={(e) => setText(e.target.value)}
          slotProps={{ htmlInput: { maxLength: MAX_GUESS_CHARS } }}
          sx={{ flex: 1 }}
        />
        <Button type="submit" variant="contained" disabled={busy || !ready}>
          Say
        </Button>
      </Stack>
      {last && !error && (
        <Typography variant="caption" color="text.secondary">
          Sent “{last}”. A right answer shows on the board within a few seconds; a wrong one gets no response, as on air.
        </Typography>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Stack>
  );
}
