"use client";

/**
 * Per-channel bottom-left deck editor: which mode-deck slides show, their order,
 * the rotation dwell and which weather charts the point-history card cycles. All
 * of it rides ControlState (slidesOff / slideOrder / slideRuns / slideHoldMs /
 * pointVarsOff)
 * and is STAGED as DELTA patches — the page's Save bar applies them to
 * /watch/:id without clobbering the operator's full state. The pinned `onair`
 * lede is shown locked: it can't be hidden or moved.
 */
import { useMemo } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import {
  SLIDE_IDS,
  DEFAULT_SLIDE_HOLD_MS,
  DEFAULT_SLIDE_RUNS,
  SLIDE_HOLD_MIN_MS,
  SLIDE_HOLD_MAX_MS,
  SLIDE_RUNS_MIN,
  SLIDE_RUNS_MAX,
  isPinnedSlide,
  type SlideId,
} from "@photonsurge/shared/broadcast-slides";
import { POINT_VARS, type PointVar } from "@photonsurge/shared/point-vars";
import SettingsCard from "./SettingsCard";
import SlideOrderList from "./SlideOrderList";
import DwellField from "./DwellField";
import RunsField from "./RunsField";
import { useSceneDraft } from "./SceneDraft";

export default function SlidesSettings() {
  const { state, stage } = useSceneDraft();

  const off = useMemo(() => new Set<string>(state.slidesOff ?? []), [state.slidesOff]);

  // The channel's effective non-pinned order: the saved ranking first, then any
  // catalog slides it doesn't mention yet (in catalog order). Pinned slides are
  // rendered separately, locked, at the top.
  const ordered = useMemo<SlideId[]>(() => {
    const saved = (state.slideOrder ?? []).filter((id) => !isPinnedSlide(id));
    const seen = new Set<string>(saved);
    const rest = SLIDE_IDS.filter((id) => !isPinnedSlide(id) && !seen.has(id));
    return [...saved, ...rest];
  }, [state.slideOrder]);

  const setVisible = (id: SlideId, visible: boolean) => {
    const next = new Set(off);
    if (visible) next.delete(id);
    else next.add(id);
    stage({ slidesOff: [...next] as SlideId[] });
  };

  const varsOff = new Set<string>(state.pointVarsOff ?? []);
  const setVar = (id: PointVar, on: boolean) => {
    const next = new Set(varsOff);
    if (on) next.delete(id);
    else next.add(id);
    stage({ pointVarsOff: [...next] as PointVar[] });
  };

  const move = (id: SlideId, dir: -1 | 1) => {
    const i = ordered.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    [next[i], next[j]] = [next[j], next[i]];
    stage({ slideOrder: next });
  };

  return (
    <SettingsCard
      id="deck"
      actions={
        <>
          <Button size="small" disabled={off.size === 0} onClick={() => stage({ slidesOff: [] })}>
            Show all
          </Button>
          <Button
            size="small"
            disabled={(state.slideOrder ?? []).length === 0}
            onClick={() => stage({ slideOrder: [] })}
          >
            Reset order
          </Button>
        </>
      }
    >
      <RunsField
        label="Runs through"
        hint="Times each slide's body is shown in full before the deck turns over — a whole top-to-bottom scroll, or one read of a body that fits."
        value={state.slideRuns ?? DEFAULT_SLIDE_RUNS}
        min={SLIDE_RUNS_MIN}
        max={SLIDE_RUNS_MAX}
        onChange={(runs) => stage({ slideRuns: runs })}
      />

      <DwellField
        label="Minimum dwell"
        valueMs={state.slideHoldMs ?? DEFAULT_SLIDE_HOLD_MS}
        defaultMs={DEFAULT_SLIDE_HOLD_MS}
        minMs={SLIDE_HOLD_MIN_MS}
        maxMs={SLIDE_HOLD_MAX_MS}
        onChange={(ms) => stage({ slideHoldMs: ms })}
      />

      <Alert severity="info" sx={{ mb: 1.5 }}>
        The on-air lede is pinned — it always opens the deck. Slides also self-hide
        when they have no data, so hiding one here just removes it for good on this channel.
        Some entries air as a RUN of pages rather than one card — the city guide gives each
        city its own page, a volcano each of its cameras — and hiding or moving the entry
        governs the whole run.
      </Alert>

      <SlideOrderList ordered={ordered} off={off} onToggle={setVisible} onMove={move} />

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
    </SettingsCard>
  );
}
