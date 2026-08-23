"use client";

/**
 * Per-channel camera-motion editor: the idle drift that keeps a camera parked
 * on a location alive — a slow orbit round the point and/or a gentle zoom
 * breathe — with how far and how fast it moves. All of it rides ControlState
 * (idleMotion / idleOrbit / idleBreathe / idlePeriodS) and is STAGED as a DELTA
 * patch (useSceneDraft) — the page's Save bar applies it to /watch/:id without
 * clobbering the operator's full state. Changes restamp spinEpoch (when no other
 * motion reads it; re-restamped at Save) so the drift restarts from the anchor.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type ControlState } from "@photonsurge/shared/control";
import { fetchSceneState } from "../../../lib/scenes";
import { useSceneDraft } from "./SceneDraft";

/** Orbit pan radius presets (degrees round the anchor; 0 = no orbit). The live
 *  pan is additionally capped by zoom so the subject can never leave frame. */
const ORBIT_PRESETS: { v: number; label: string }[] = [
  { v: 0, label: "Off" },
  { v: 1.5, label: "Tight · 1.5°" },
  { v: 3, label: "Gentle · 3°" },
  { v: 5, label: "Wide · 5°" },
  { v: 8, label: "Sweeping · 8°" },
];

/** Zoom breathe amplitude presets (zoom levels in-and-back; 0 = no breathe). */
const BREATHE_PRESETS: { v: number; label: string }[] = [
  { v: 0, label: "Off" },
  { v: 0.15, label: "Subtle · 0.15" },
  { v: 0.25, label: "Gentle · 0.25" },
  { v: 0.5, label: "Deep · 0.5" },
];

/** Full-cycle presets (seconds for one orbit circle / breathe). */
const CYCLE_PRESETS: { v: number; label: string }[] = [
  { v: 30, label: "Fast · 30s" },
  { v: 45, label: "Brisk · 45s" },
  { v: 60, label: "Normal · 60s" },
  { v: 90, label: "Slow · 90s" },
  { v: 120, label: "Very slow · 120s" },
];

/** A non-preset persisted value still needs an option to sit on, or MUI warns. */
const withCurrent = (presets: { v: number; label: string }[], v: number, unit: string) =>
  presets.some((p) => p.v === v) ? presets : [...presets, { v, label: `${v}${unit}` }];

export default function CameraSettings({ sceneId }: { sceneId: string }) {
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

  const apply = (over: Partial<ControlState>) => {
    if (!state) return;
    // Restart the motion phase so the drift eases out from the anchor — but
    // ONLY while nothing else reads the epoch (the world spin / a director
    // push-in or orbit), or the restamp would jump that motion mid-shot.
    const epochSafe = !state.autoSpin && !state.zoomDrift && !state.orbitDrift;
    const out = epochSafe ? { ...over, spinEpoch: Date.now() } : over;
    setState({ ...state, ...out });
    patch(sceneId, out);
  };

  if (!state) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading channel…
      </Typography>
    );
  }

  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.25 }}>
        Camera motion
      </Typography>

      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={state.idleMotion}
            onChange={(e) => apply({ idleMotion: e.target.checked })}
            slotProps={{ input: { "aria-label": "Keep the camera moving" } }}
            sx={{ p: 0.5 }}
          />
        }
        label={<Typography variant="body2">Keep the camera moving</Typography>}
        sx={{ mb: 1 }}
      />

      <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", mb: 1.5 }}>
        <TextField
          select
          size="small"
          label="Orbit"
          disabled={!state.idleMotion}
          value={state.idleOrbit}
          onChange={(e) => apply({ idleOrbit: Number(e.target.value) })}
          sx={{ minWidth: 150 }}
          slotProps={{ htmlInput: { "aria-label": "Orbit" } }}
        >
          {withCurrent(ORBIT_PRESETS, state.idleOrbit, "°").map((p) => (
            <MenuItem key={p.v} value={p.v}>
              {p.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Zoom breathe"
          disabled={!state.idleMotion}
          value={state.idleBreathe}
          onChange={(e) => apply({ idleBreathe: Number(e.target.value) })}
          sx={{ minWidth: 150 }}
          slotProps={{ htmlInput: { "aria-label": "Zoom breathe" } }}
        >
          {withCurrent(BREATHE_PRESETS, state.idleBreathe, "").map((p) => (
            <MenuItem key={p.v} value={p.v}>
              {p.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Cycle speed"
          disabled={!state.idleMotion}
          value={state.idlePeriodS}
          onChange={(e) => apply({ idlePeriodS: Number(e.target.value) })}
          sx={{ minWidth: 150 }}
          slotProps={{ htmlInput: { "aria-label": "Cycle speed" } }}
        >
          {withCurrent(CYCLE_PRESETS, state.idlePeriodS, "s").map((p) => (
            <MenuItem key={p.v} value={p.v}>
              {p.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Alert severity="info">
        Adds a slight drift whenever this channel&apos;s camera settles on a location —
        slowly circling the point and gently zooming in and back out. The orbit rides
        along with the director&apos;s push-in shots; a zoom breathe replaces the push-in
        outright. Only the world spin and the director&apos;s own orbits mute it.
      </Alert>
    </Paper>
  );
}
