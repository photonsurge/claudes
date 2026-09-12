"use client";

/**
 * Per-channel YouTube publishing card: the title and description templates and
 * the thumbnail image every broadcast on this channel is created with. Rides
 * ControlState.youtube and is STAGED as a DELTA patch (useSceneDraft) — the
 * page's Save bar applies it without clobbering the operator's live state.
 * Templates resolve once, when the worker creates the broadcast; a run/slot
 * title still overrides the channel's. Empty fields fall back to the built-in
 * defaults (automatic title, the globe blurb, the horizontal logo).
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ControlState } from "@photonsurge/shared/control";
import { fetchSceneState } from "../../../lib/scenes";
import StreamDescriptionField from "../../StreamDescriptionField";
import StreamThumbnailField from "../../StreamThumbnailField";
import StreamTitleField from "../../StreamTitleField";
import { useSceneDraft } from "./SceneDraft";

export default function YoutubeSettings({ sceneId }: { sceneId: string }) {
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
  // whole youtube object rebuilt from the freshest local state.
  const apply = (over: Partial<ControlState["youtube"]>) => {
    if (!state) return;
    const youtube = { ...state.youtube, ...over };
    setState({ ...state, youtube });
    patch(sceneId, { youtube });
  };

  if (!state) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading channel…
      </Typography>
    );
  }

  const youtube = state.youtube;

  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.25 }}>
        YouTube broadcasts
      </Typography>

      <Stack spacing={2} sx={{ mb: 1.5 }}>
        <StreamTitleField value={youtube.title} onChange={(title) => apply({ title })} recurring />
        <StreamDescriptionField value={youtube.description} onChange={(description) => apply({ description })} recurring />
        <StreamThumbnailField value={youtube.thumbnailUrl} onChange={(thumbnailUrl) => apply({ thumbnailUrl })} />
      </Stack>

      <Alert severity="info">
        Every stream started on this channel — one-off runs from /control and its constant streams —
        is created on YouTube with this title, description and thumbnail. Codes are resolved when the
        broadcast is created; a title typed on a constant stream or in the stream panel overrides the
        channel&apos;s. A video that is already live keeps what it was created with.
      </Alert>
    </Paper>
  );
}
