"use client";

/**
 * The sticky Save bar: appears once something is staged, names the cards a Save
 * will change, and keeps the draft when a write fails. One bar for both
 * documents (the channel record and the crossword config).
 */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { changedCards } from "./catalog";
import { useChannelDraft } from "./ChannelDraft";

/** Above this many changed cards, Discard asks first. */
const CONFIRM_DISCARD_OVER = 2;

export default function ChannelSaveBar() {
  const { pending, pendingCrossword, saved, dirty, saving, saveError, save, discard } = useChannelDraft();
  const [confirming, setConfirming] = useState(false);
  if (!dirty) return null;

  const changed = changedCards(pending, pendingCrossword, saved.youtube);
  const count = changed.length;
  const onDiscard = () => {
    if (count > CONFIRM_DISCARD_OVER && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    discard();
  };

  return (
    <Paper elevation={6} sx={{ position: "sticky", bottom: 12, zIndex: 10, mt: 2, p: 1.25, pl: 1.75 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        <Typography variant="body2" sx={{ flex: 1, minWidth: 220 }}>
          <strong>
            {count} unsaved {count === 1 ? "change" : "changes"}
          </strong>
          {count > 0 ? ` · ${changed.map((c) => c.title).join(", ")}` : null}
          <Typography component="span" variant="body2" color="text.secondary">
            {" "}
            — nothing has gone on air yet.
          </Typography>
        </Typography>
        <Button size="small" color="inherit" disabled={saving} onClick={onDiscard}>
          {confirming ? `Discard all ${count}?` : "Discard"}
        </Button>
        <Button size="small" variant="contained" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </Stack>
      {saveError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          Save failed — your changes are still here, nothing was lost. {saveError}
        </Alert>
      )}
    </Paper>
  );
}
