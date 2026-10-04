"use client";

/**
 * Starting points for a channel's programme: apply a template (maps / events /
 * ocean / full feed) or copy another channel's whole director setup. Both stage
 * into the draft like any hand edit, after a confirm naming what gets replaced;
 * Save commits. Nothing stays linked — later edits to the template or the
 * source channel change nothing here.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { SceneMeta } from "@photonsurge/shared/control";
import {
  DIRECTOR_TEMPLATES,
  DIRECTOR_TEMPLATE_LIST,
  copyablePatch,
  templateChanges,
  templatePatch,
  type DirectorTemplateId,
  type TemplateKey,
} from "@photonsurge/shared/director-templates";
import { loadDirectorConfig } from "../../../lib/director";
import { listScenes } from "../../../lib/scenes";
import { useSceneDraft } from "./SceneDraft";

/** How each template key reads in the confirm. */
export const TEMPLATE_KEY_LABEL: Record<TemplateKey, string> = {
  kinds: "Which slide types air",
  kindWeights: "How often each type comes up",
  kindHoldSeconds: "Hold times",
  minQuakeMag: "Quake bar",
  minAlertSeverity: "Storm bar",
  adEveryNShots: "Ad cadence",
  pools: "Event pools",
  tours: "Tours",
  tempo: "Map tempo",
};

export default function DirectorTemplateBar() {
  const { sceneId, config, stageDirector } = useSceneDraft();
  const [picked, setPicked] = useState<DirectorTemplateId | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [scenes, setScenes] = useState<SceneMeta[] | null>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!copyOpen || scenes) return;
    let live = true;
    listScenes().then((all) => live && setScenes(all.filter((s) => s.id !== sceneId)));
    return () => {
      live = false;
    };
  }, [copyOpen, scenes, sceneId]);

  const changes = picked ? templateChanges(config, picked) : [];

  const applyTemplate = () => {
    if (picked) stageDirector(templatePatch(picked));
    setPicked(null);
  };

  const closeCopy = () => {
    setCopyOpen(false);
    setSource("");
    setError(null);
  };

  const copy = async () => {
    setBusy(true);
    setError(null);
    const cfg = await loadDirectorConfig(source);
    setBusy(false);
    if (!cfg) {
      setError("Couldn't read that channel's setup — nothing was changed.");
      return;
    }
    stageDirector(copyablePatch(cfg));
    closeCopy();
  };

  return (
    <>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center", mb: 1.5 }}>
        <TextField
          select
          size="small"
          label="Apply template"
          value=""
          onChange={(e) => setPicked(e.target.value as DirectorTemplateId)}
          sx={{ minWidth: 180 }}
        >
          {DIRECTOR_TEMPLATE_LIST.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.label}
            </MenuItem>
          ))}
        </TextField>
        <Button size="small" variant="outlined" onClick={() => setCopyOpen(true)}>
          Copy from channel…
        </Button>
      </Stack>

      <Dialog open={!!picked} onClose={() => setPicked(null)} aria-labelledby="template-confirm-title">
        <DialogTitle id="template-confirm-title">Apply “{picked ? DIRECTOR_TEMPLATES[picked].label : ""}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {picked ? DIRECTOR_TEMPLATES[picked].blurb : ""}
          </Typography>
          {changes.length ? (
            <>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                This replaces:
              </Typography>
              <ul style={{ margin: 0, paddingLeft: 20 }} aria-label="Replaced settings">
                {changes.map((k) => (
                  <li key={k}>
                    <Typography variant="body2">{TEMPLATE_KEY_LABEL[k]}</Typography>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              This channel already matches it — nothing would change.
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            Looks, slides and break-ins stay as they are. Nothing is saved until you press Save.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPicked(null)}>Cancel</Button>
          <Button variant="contained" disabled={!changes.length} onClick={applyTemplate}>
            Apply
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={copyOpen} onClose={closeCopy} aria-labelledby="copy-from-title" fullWidth maxWidth="xs">
        <DialogTitle id="copy-from-title">Copy from channel</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            Replaces this channel&apos;s whole director setup — content, pacing, pools, looks, slides and
            break-ins — with another channel&apos;s. Auto/Off stays as it is.
          </Typography>
          <TextField
            select
            fullWidth
            size="small"
            label="Channel"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            disabled={!scenes}
            helperText={scenes && !scenes.length ? "There are no other channels yet." : undefined}
          >
            {(scenes ?? []).map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
          {error ? (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {error}
            </Alert>
          ) : null}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            A new channel created from another already starts with a copy of its setup.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCopy}>Cancel</Button>
          <Button variant="contained" disabled={!source || busy} onClick={copy}>
            Copy
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
