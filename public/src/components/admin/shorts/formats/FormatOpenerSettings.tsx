"use client";

/**
 * Opener and close card (§5.2 `opener`, `close`): whether the deck opens on the
 * place round-up and how much of it shows, whether the camera flies the tour
 * (and its shortest stop), the opener's share of the budget when events follow,
 * and the closing wide shot. Stages whole `opener` / `close` fields.
 */
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import {
  DEFAULT_CLOSE_MS,
  DEFAULT_MIN_TOUR_DWELL_MS,
  DEFAULT_OPENER_BUDGET_SHARE,
  FORMAT_TIMING_MAX_MS,
  OPENER_SHARE_MAX,
  OPENER_SHARE_MIN,
  type ShortFormat,
} from "@photonsurge/shared/short-format";
import { MIN_CLIP_MS, TOUR_DWELL_MAX_MS, TOUR_DWELL_MIN_MS, type RoundupDepth } from "@photonsurge/shared/short-script";
import SettingsCard from "../../scenes/SettingsCard";
import TuningField from "../../scenes/TuningField";
import { useSceneDraft } from "../../scenes/SceneDraft";

const row = { display: "flex", flexWrap: "wrap", gap: 1.5 } as const;

export default function FormatOpenerSettings() {
  const { format, stageFormat } = useSceneDraft();
  if (!format) return null;
  const o = format.opener;
  const c = format.close;
  const setOpener = (over: Partial<ShortFormat["opener"]>) => stageFormat({ opener: { ...o, ...over } });
  const setClose = (over: Partial<ShortFormat["close"]>) => stageFormat({ close: { ...c, ...over } });

  return (
    <SettingsCard id="opener" blurb="How a video of this format opens on its place, and how it ends.">
      <Stack spacing={1.5}>
        <FormControlLabel
          control={<Switch checked={o.leadWithRoundup} onChange={(e) => setOpener({ leadWithRoundup: e.target.checked })} />}
          label="Open the deck on the round-up"
        />
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Typography variant="body2">Round-up shown</Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={o.roundupDepth}
            onChange={(_e, v: RoundupDepth | null) => v && setOpener({ roundupDepth: v })}
            aria-label="Round-up depth"
          >
            <ToggleButton value="summary">Summary</ToggleButton>
            <ToggleButton value="full">All of it</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <FormControlLabel
          control={<Switch checked={o.tour} onChange={(e) => setOpener({ tour: e.target.checked })} />}
          label="Fly the tour (off: hold one framed shot)"
        />
        <Box sx={row}>
          <TuningField
            label="Shortest tour stop"
            value={o.minTourDwellMs / 1000}
            defaultValue={DEFAULT_MIN_TOUR_DWELL_MS / 1000}
            min={TOUR_DWELL_MIN_MS / 1000}
            max={TOUR_DWELL_MAX_MS / 1000}
            unit="s"
            onChange={(v) => setOpener({ minTourDwellMs: Math.round(v * 1000) })}
          />
          <TuningField
            label="Opener share with events"
            value={Math.round(o.budgetShare * 100)}
            defaultValue={DEFAULT_OPENER_BUDGET_SHARE * 100}
            min={OPENER_SHARE_MIN * 100}
            max={OPENER_SHARE_MAX * 100}
            integer
            unit="%"
            onChange={(v) => setOpener({ budgetShare: v / 100 })}
          />
        </Box>

        <Typography variant="subtitle2" sx={{ pt: 1 }}>
          Close
        </Typography>
        <Box sx={{ ...row, alignItems: "flex-start" }}>
          <FormControlLabel
            control={<Switch checked={c.enabled} onChange={(e) => setClose({ enabled: e.target.checked })} />}
            label="End on a wide shot"
          />
          <TuningField
            label="Close length"
            value={c.ms / 1000}
            defaultValue={DEFAULT_CLOSE_MS / 1000}
            min={MIN_CLIP_MS / 1000}
            max={FORMAT_TIMING_MAX_MS / 1000}
            unit="s"
            onChange={(v) => setClose({ ms: Math.round(v * 1000) })}
          />
        </Box>
      </Stack>
    </SettingsCard>
  );
}
