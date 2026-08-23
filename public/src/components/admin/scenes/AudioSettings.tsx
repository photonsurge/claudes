"use client";

/**
 * Per-channel music-bed editor: the generative audio bed each /watch output
 * synthesizes client-side — on/off, which arrangement plays (Auto follows the
 * broadcast), mute and master volume. All of it rides ControlState.audio and is
 * STAGED as a DELTA patch (useSceneDraft) — the page's Save bar applies it to
 * /watch/:id without clobbering the operator's live state.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { AUDIO_MODES, type AudioMode, type ControlState } from "@photonsurge/shared/control";
import { fetchSceneState } from "../../../lib/scenes";
import { useSceneDraft } from "./SceneDraft";

/** Operator-facing labels for the bed's modes (see shared AUDIO_MODES). */
const AUDIO_MODE_LABELS: Record<AudioMode, string> = {
  auto: "Auto — follows broadcast",
  chill: "Chill Out",
  lounge: "Lounge House",
  deep: "Deep House",
  minimal: "Minimal Techno",
  breaks: "Breaks · Severe",
};

export default function AudioSettings({ sceneId }: { sceneId: string }) {
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
  // whole audio object rebuilt from the freshest local state.
  const apply = (over: Partial<ControlState["audio"]>) => {
    if (!state) return;
    const audio = { ...state.audio, ...over };
    setState({ ...state, audio });
    patch(sceneId, { audio });
  };

  if (!state) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading channel…
      </Typography>
    );
  }

  const audio = state.audio;

  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.25 }}>
        Music bed
      </Typography>

      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={audio.enabled}
            onChange={(e) => apply({ enabled: e.target.checked })}
            slotProps={{ input: { "aria-label": "Music" } }}
            sx={{ p: 0.5 }}
          />
        }
        label={<Typography variant="body2">Music</Typography>}
        sx={{ mb: 1 }}
      />

      <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center", mb: 1.5 }}>
        <TextField
          select
          size="small"
          label="Mode"
          disabled={!audio.enabled}
          value={audio.mode}
          onChange={(e) => apply({ mode: e.target.value as AudioMode })}
          sx={{ minWidth: 210 }}
          slotProps={{ htmlInput: { "aria-label": "Audio mode" } }}
        >
          {AUDIO_MODES.map((m) => (
            <MenuItem key={m} value={m}>
              {AUDIO_MODE_LABELS[m]}
            </MenuItem>
          ))}
        </TextField>

        <FormControlLabel
          control={
            <Checkbox
              size="small"
              disabled={!audio.enabled}
              checked={audio.muted}
              onChange={(e) => apply({ muted: e.target.checked })}
              slotProps={{ input: { "aria-label": "Mute" } }}
              sx={{ p: 0.5 }}
            />
          }
          label={<Typography variant="body2">Mute</Typography>}
        />

        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 240 }}>
          <Typography variant="body2" color="text.secondary">
            Volume
          </Typography>
          <Slider
            size="small"
            disabled={!audio.enabled}
            min={0}
            max={1}
            step={0.05}
            value={audio.volume}
            onChange={(_e, v) => apply({ volume: v as number })}
            aria-label="Audio volume"
            sx={{ width: 140 }}
          />
          <Typography variant="body2" sx={{ width: 40, textAlign: "right" }}>
            {Math.round(audio.volume * 100)}%
          </Typography>
        </Stack>
      </Stack>

      <Alert severity="info">
        Generative music on this channel&apos;s /watch output — Auto follows the on-air
        segment. Browsers need one click on the watch page before audio can start; OBS
        plays immediately.
      </Alert>
    </Paper>
  );
}
