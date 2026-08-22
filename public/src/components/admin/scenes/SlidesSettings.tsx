"use client";

/**
 * Per-channel bottom-left deck editor: which mode-deck slides show, their order,
 * and the rotation dwell. All three ride ControlState (slidesOff / slideOrder /
 * slideHoldMs) and are DELTA-patched (useScenePatcher) so they apply live on
 * /watch/:id without clobbering the operator's full state. The pinned `onair`
 * lede is shown locked — it can't be hidden or moved.
 */
import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  BROADCAST_SLIDES,
  SLIDE_IDS,
  SLIDE_GROUP_LABELS,
  DEFAULT_SLIDE_HOLD_MS,
  isPinnedSlide,
  type SlideId,
} from "@photonsurge/shared/broadcast-slides";
import { POINT_VARS, type PointVar } from "@photonsurge/shared/point-vars";
import { type ControlState } from "@photonsurge/shared/control";
import FormControlLabel from "@mui/material/FormControlLabel";
import { fetchSceneState, useScenePatcher } from "../../../lib/scenes";

const SLIDE_BY_ID = new Map(BROADCAST_SLIDES.map((s) => [s.id, s]));

/** Dwell presets for the rotation-speed picker (label ↔ ms). */
const HOLD_PRESETS: { ms: number; label: string }[] = [
  { ms: 8000, label: "Fast · 8s" },
  { ms: 12000, label: "Brisk · 12s" },
  { ms: 16000, label: "Normal · 16s" },
  { ms: 24000, label: "Slow · 24s" },
  { ms: 32000, label: "Slower · 32s" },
  { ms: 40000, label: "Very slow · 40s" },
];

export default function SlidesSettings({ sceneId }: { sceneId: string }) {
  const patch = useScenePatcher();
  const [state, setState] = useState<ControlState | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSceneState(sceneId).then(({ state: s }) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  const off = useMemo(() => new Set<string>(state?.slidesOff ?? []), [state]);

  // The channel's effective non-pinned order: the saved ranking first, then any
  // catalog slides it doesn't mention yet (in catalog order). Pinned slides are
  // rendered separately, locked, at the top.
  const ordered = useMemo<SlideId[]>(() => {
    const saved = (state?.slideOrder ?? []).filter((id) => !isPinnedSlide(id));
    const seen = new Set<string>(saved);
    const rest = SLIDE_IDS.filter((id) => !isPinnedSlide(id) && !seen.has(id));
    return [...saved, ...rest];
  }, [state]);

  const apply = (over: Partial<ControlState>) => {
    if (!state) return;
    setState({ ...state, ...over });
    patch(sceneId, over);
  };

  const setVisible = (id: SlideId, visible: boolean) => {
    const next = new Set(off);
    if (visible) next.delete(id);
    else next.add(id);
    apply({ slidesOff: [...next] as SlideId[] });
  };

  const varsOff = new Set<string>(state?.pointVarsOff ?? []);
  const setVar = (id: PointVar, on: boolean) => {
    const next = new Set(varsOff);
    if (on) next.delete(id);
    else next.add(id);
    apply({ pointVarsOff: [...next] as PointVar[] });
  };

  const move = (id: SlideId, dir: -1 | 1) => {
    const i = ordered.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    [next[i], next[j]] = [next[j], next[i]];
    apply({ slideOrder: next });
  };

  if (!state) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading channel…
      </Typography>
    );
  }

  const pinned = BROADCAST_SLIDES.filter((s) => s.pinned);
  const holdMs = state.slideHoldMs ?? DEFAULT_SLIDE_HOLD_MS;
  // A non-preset persisted value still needs an option to sit on, or MUI warns.
  const holdOptions = HOLD_PRESETS.some((p) => p.ms === holdMs)
    ? HOLD_PRESETS
    : [...HOLD_PRESETS, { ms: holdMs, label: `${Math.round(holdMs / 1000)}s` }];

  return (
    <Paper sx={{ p: 1.75 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.25 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Bottom-left deck
        </Typography>
        <Button size="small" disabled={off.size === 0} onClick={() => apply({ slidesOff: [] })}>
          Show all
        </Button>
        <Button
          size="small"
          disabled={(state.slideOrder ?? []).length === 0}
          onClick={() => apply({ slideOrder: [] })}
        >
          Reset order
        </Button>
      </Stack>

      <TextField
        select
        size="small"
        label="Rotation dwell"
        value={holdMs}
        onChange={(e) => apply({ slideHoldMs: Number(e.target.value) })}
        sx={{ mb: 1.5, minWidth: 180 }}
        slotProps={{ htmlInput: { "aria-label": "Rotation dwell" } }}
      >
        {holdOptions.map((p) => (
          <MenuItem key={p.ms} value={p.ms}>
            {p.label}
          </MenuItem>
        ))}
      </TextField>

      <Alert severity="info" sx={{ mb: 1.5 }}>
        The on-air lede is pinned — it always opens the deck. Slides also self-hide
        when they have no data, so hiding one here just removes it for good on this channel.
      </Alert>

      <Box sx={{ display: "grid", gap: 0.5 }}>
        {pinned.map((s) => (
          <Row key={s.id} label={s.label} group={SLIDE_GROUP_LABELS[s.group]} pinned />
        ))}
        {ordered.map((id, idx) => {
          const s = SLIDE_BY_ID.get(id);
          if (!s) return null;
          return (
            <Row
              key={id}
              label={s.label}
              group={SLIDE_GROUP_LABELS[s.group]}
              checked={!off.has(id)}
              onToggle={(v) => setVisible(id, v)}
              onUp={idx > 0 ? () => move(id, -1) : undefined}
              onDown={idx < ordered.length - 1 ? () => move(id, 1) : undefined}
            />
          );
        })}
      </Box>

      {/* Point-history variables — which weather charts the POINT / AREA HISTORY
          card (the "history" slide above) cycles on this channel. */}
      <Box sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: "divider" }}>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Point history variables
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          The weather charts on the POINT / AREA HISTORY card. Each self-hides with no data too.
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
          {POINT_VARS.map((v) => (
            <FormControlLabel
              key={v.id}
              control={
                <Checkbox
                  size="small"
                  checked={!varsOff.has(v.id)}
                  onChange={(e) => setVar(v.id, e.target.checked)}
                  slotProps={{ input: { "aria-label": v.label } }}
                  sx={{ p: 0.5 }}
                />
              }
              label={
                <Typography variant="body2">
                  {v.label}
                  {v.ocean && (
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                      (ocean)
                    </Typography>
                  )}
                </Typography>
              }
            />
          ))}
        </Box>
      </Box>
    </Paper>
  );
}

function Row({
  label,
  group,
  checked,
  pinned,
  onToggle,
  onUp,
  onDown,
}: {
  label: string;
  group: string;
  checked?: boolean;
  pinned?: boolean;
  onToggle?: (v: boolean) => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", py: 0.25, opacity: pinned ? 0.7 : 1 }}
    >
      <Checkbox
        size="small"
        checked={pinned ? true : !!checked}
        disabled={pinned}
        onChange={(e) => onToggle?.(e.target.checked)}
        slotProps={{ input: { "aria-label": label } }}
        sx={{ p: 0.5 }}
      />
      <Typography variant="body2" sx={{ flex: 1 }}>
        {label}
        {pinned && (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
            (pinned)
          </Typography>
        )}
      </Typography>
      <Chip label={group} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
      <IconButton
        size="small"
        disabled={!onUp}
        onClick={onUp}
        aria-label={`Move ${label} up`}
        sx={{ p: 0.25, width: 24, height: 24 }}
      >
        ↑
      </IconButton>
      <IconButton
        size="small"
        disabled={!onDown}
        onClick={onDown}
        aria-label={`Move ${label} down`}
        sx={{ p: 0.25, width: 24, height: 24 }}
      >
        ↓
      </IconButton>
    </Stack>
  );
}
