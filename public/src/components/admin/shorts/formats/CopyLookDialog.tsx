"use client";

/**
 * "Copy look from…" (docs/short-video-plan.md §5.1): re-copy a channel's or
 * another format's look — its scene (layout, presentation, about card) and
 * director setup (looks and thresholds) — onto this format, after a confirm.
 * The only way a channel's later changes reach a format. The format's short
 * settings (the Video cards) are kept.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import type { SceneMeta } from "@photonsurge/shared/control";
import { copyFormatLook, loadFormatSources } from "../../../../lib/short-formats";
import FormatSourceSelect from "./FormatSourceSelect";

export default function CopyLookDialog({
  formatId,
  open,
  dirty,
  onClose,
  onCopied,
  load = loadFormatSources,
  copy = copyFormatLook,
}: {
  formatId: string;
  open: boolean;
  /** The editor has unsaved edits — copying reloads it, so it says they go. */
  dirty: boolean;
  onClose: () => void;
  /** The look was copied; the editor reloads its draft and its preview. */
  onCopied: (fromName: string) => void;
  load?: typeof loadFormatSources;
  copy?: typeof copyFormatLook;
}) {
  const [sources, setSources] = useState<{ channels: SceneMeta[]; formats: { id: string; name: string }[] }>({
    channels: [],
    formats: [],
  });
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFrom("");
    setError(null);
    load().then(setSources);
  }, [open, load]);

  const all = [...sources.channels, ...sources.formats];
  const fromName = all.find((s) => s.id === from)?.name ?? from;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const res = await copy(formatId, from);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCopied(fromName);
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Copy look from…</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Replaces this format&apos;s look — layout, presentation, the about card, and looks and thresholds — with a
          copy of another channel&apos;s or format&apos;s, as it is now. There is no link back: later changes there
          won&apos;t follow. The Video cards (template, opener, YouTube video, timing, render defaults) are kept.
        </Typography>
        <FormatSourceSelect
          label="Copy from"
          value={from}
          onChange={setFrom}
          channels={sources.channels}
          formats={sources.formats}
          exclude={formatId}
          disabled={busy}
        />
        {from && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            This overwrites the look with “{fromName}”&apos;s and can&apos;t be undone.
            {dirty ? " Your unsaved changes on this page are discarded." : ""}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy} color="inherit">
          Cancel
        </Button>
        <Button variant="contained" onClick={confirm} disabled={busy || !from}>
          {busy ? "Copying…" : "Copy look"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
