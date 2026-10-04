"use client";

/**
 * The settings page's sticky Save bar. It appears only once something is staged
 * and it NAMES what a Save will change — with eighteen cards across four groups
 * you can stage an edit, scroll away and forget it, and "Unsaved changes" alone
 * is not enough to save confidently.
 *
 * Save awaits every write and reports a failure instead of swallowing it; the
 * draft survives a failed save, because at that point it is the only copy of
 * the operator's work.
 */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { cardsForStagedKeys } from "./catalog";
import { useSceneDraft } from "./SceneDraft";

/** Above this many changed cards, Discard asks first. */
const CONFIRM_DISCARD_OVER = 2;

export default function SceneSaveBar() {
  const { pending, pendingDirector, pendingCrossword, dirty, conflictKeys, saving, saveError, save, discard } =
    useSceneDraft();
  const [confirming, setConfirming] = useState(false);

  if (!dirty) return null;

  const changed = cardsForStagedKeys(
    Object.keys(pending),
    Object.keys(pendingDirector),
    Object.keys(pendingCrossword),
  );
  const names = changed.map((c) => c.title).join(", ");
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
    <Paper
      elevation={6}
      sx={{ position: "sticky", bottom: 12, zIndex: 10, mt: 2, p: 1.25, pl: 1.75 }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        <Typography variant="body2" sx={{ flex: 1, minWidth: 220 }}>
          <strong>
            {count} unsaved {count === 1 ? "change" : "changes"}
          </strong>
          {names ? ` · ${names}` : null}
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

      {conflictKeys.length > 0 && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          The operator changed {conflictKeys.length === 1 ? "a setting" : "settings"} you have
          edited here while you were working. Saving will overwrite the desk&apos;s version.
        </Alert>
      )}

      {saveError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          Save failed — your changes are still here, nothing was lost. {saveError}
        </Alert>
      )}
    </Paper>
  );
}
