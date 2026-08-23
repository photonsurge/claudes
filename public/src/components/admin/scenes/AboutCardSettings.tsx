"use client";

/**
 * Per-channel ABOUT card editor: the copy on the top-right WORLD REPORT deck's
 * ABOUT slide — the channel's own description, its data-source credits and the
 * small-print footnote. All of it rides ControlState.about and is STAGED as a
 * DELTA patch (useSceneDraft) — the page's Save bar applies it to /watch/:id
 * without clobbering the operator's live state. Empty fields fall back to the
 * built-in G.O.D.S. copy, so an untouched channel reads exactly as before.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { ControlState } from "@photonsurge/shared/control";
import { fetchSceneState } from "../../../lib/scenes";
import { useSceneDraft } from "./SceneDraft";

export default function AboutCardSettings({ sceneId }: { sceneId: string }) {
  const { stage: patch, epoch } = useSceneDraft();
  const [state, setState] = useState<ControlState | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSceneState(sceneId).then(({ state: s }) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId, epoch]);

  // Staged deltas spread-merge at the TOP level, so every change ships the
  // whole about object rebuilt from the freshest local state.
  const apply = (over: Partial<ControlState["about"]>) => {
    if (!state) return;
    const about = { ...state.about, ...over };
    setState({ ...state, about });
    patch(sceneId, { about });
  };

  if (!state) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading channel…
      </Typography>
    );
  }

  const about = state.about;

  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.25 }}>
        About card
      </Typography>

      <Stack spacing={1.5} sx={{ mb: 1.5 }}>
        <TextField
          size="small"
          label="Title"
          value={about.title}
          onChange={(e) => apply({ title: e.target.value })}
          placeholder="About G.O.D.S."
          slotProps={{ htmlInput: { "aria-label": "About title" } }}
        />
        <TextField
          size="small"
          label="Body"
          multiline
          minRows={5}
          value={about.body}
          onChange={(e) => apply({ body: e.target.value })}
          helperText="A blank line starts a new paragraph. Empty = the built-in G.O.D.S. description."
          slotProps={{ htmlInput: { "aria-label": "About body" } }}
        />
        <TextField
          size="small"
          label="Data sources"
          multiline
          minRows={2}
          value={about.sources}
          onChange={(e) => apply({ sources: e.target.value })}
          helperText="One per line or comma-separated — e.g. NOAA GFS, USGS, GDACS. Empty = no sources line."
          slotProps={{ htmlInput: { "aria-label": "About sources" } }}
        />
        <TextField
          size="small"
          label="Footnote"
          multiline
          minRows={2}
          value={about.footer}
          onChange={(e) => apply({ footer: e.target.value })}
          helperText="Small print under the divider. Empty = the standard not-an-official-warning-service disclaimer."
          slotProps={{ htmlInput: { "aria-label": "About footnote" } }}
        />
      </Stack>

      <Alert severity="info">
        The ABOUT slide in this channel&apos;s top-right WORLD REPORT rotation — its own
        description and the data sources it uses. Show, hide or reorder the slide itself
        in the World report card above.
      </Alert>
    </Paper>
  );
}
