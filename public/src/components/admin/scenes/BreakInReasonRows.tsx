"use client";

/**
 * The "What breaks in" rows of the Break-ins card: one per reason, each a
 * switch plus its threshold in words, with the channel's pool bar printed
 * underneath so the two bars read as one decision. A threshold never offers a
 * value below the pool bar (the server would raise it anyway).
 */
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { DirectorConfig, SegmentKind } from "@photonsurge/shared/director";
import type { BreakInConfig, BreakInReason } from "@photonsurge/shared/director-break-in";
import { SEVERITY_LABELS } from "@photonsurge/shared/alerts/severity";
import { QUAKE_MAGNITUDE_BANDS } from "@photonsurge/shared/seismic";
import TuningField from "./TuningField";

const SEVERITIES = [0, 1, 2, 3, 4] as const;
/** Break-in magnitudes: the named band floors, M3 – M8. */
const MAGNITUDES = QUAKE_MAGNITUDE_BANDS.filter((b) => Number.isFinite(b.min)).map((b) => ({ m: b.min, label: b.label })).reverse();

/** Which slide type each reason needs switched on to air at all. */
const KIND_OF: Record<Exclude<BreakInReason, "roundup">, SegmentKind> = { quake: "quake", storm: "storm", volcano: "volcano" };

export default function BreakInReasonRows({
  b,
  cfg,
  set,
}: {
  b: BreakInConfig;
  cfg: DirectorConfig;
  set: (patch: Partial<BreakInConfig>) => void;
}) {
  const reason = (r: BreakInReason, label: string) => (
    <FormControlLabel
      control={<Switch size="small" checked={b.reasons[r]} onChange={(e) => set({ reasons: { ...b.reasons, [r]: e.target.checked } })} />}
      label={label}
      sx={{ minWidth: 190 }}
    />
  );
  const kindOff = (r: Exclude<BreakInReason, "roundup">, label: string) =>
    b.reasons[r] && !cfg.kinds[KIND_OF[r]] ? (
      <Alert severity="info" sx={{ mt: 0.5 }}>
        {label} are off in the Content card, so they can&apos;t break in.
      </Alert>
    ) : null;
  const rowSx = { mb: 1.75 };
  const line = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5 } as const;

  const magnitudes = [...new Set([...MAGNITUDES.map((x) => x.m), b.minQuakeMag])].sort((x, y) => x - y);

  return (
    <>
      <Box sx={rowSx}>
        <Box sx={line}>
          {reason("quake", "Earthquakes")}
          <TextField
            select
            size="small"
            label="Earthquakes from"
            value={b.minQuakeMag}
            onChange={(e) => set({ minQuakeMag: Number(e.target.value) })}
            disabled={!b.reasons.quake}
            sx={{ width: 180 }}
          >
            {magnitudes.map((m) => (
              <MenuItem key={m} value={m} disabled={m < cfg.minQuakeMag}>
                M{m.toFixed(1)} {MAGNITUDES.find((x) => x.m === m)?.label ?? ""}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        <Typography variant="caption" color="text.secondary">
          This channel airs M{cfg.minQuakeMag.toFixed(1)}+ · breaking in at M{b.minQuakeMag.toFixed(1)}+
        </Typography>
        {kindOff("quake", "Earthquakes")}
      </Box>

      <Box sx={rowSx}>
        <Box sx={line}>
          {reason("storm", "Weather warnings")}
          <TextField
            select
            size="small"
            label="Warnings from"
            value={b.minAlertSeverity}
            onChange={(e) => set({ minAlertSeverity: Number(e.target.value) as BreakInConfig["minAlertSeverity"] })}
            disabled={!b.reasons.storm}
            sx={{ width: 180 }}
          >
            {SEVERITIES.map((s) => (
              <MenuItem key={s} value={s} disabled={s < cfg.minAlertSeverity}>
                {SEVERITY_LABELS[s]}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        <Typography variant="caption" color="text.secondary">
          This channel airs {SEVERITY_LABELS[cfg.minAlertSeverity as 0]}+ warnings · breaking in at{" "}
          {SEVERITY_LABELS[b.minAlertSeverity]}+
        </Typography>
        {kindOff("storm", "Severe storms")}
      </Box>

      <Box sx={rowSx}>
        <Box sx={line}>
          {reason("volcano", "Volcanoes")}
          <TextField
            select
            size="small"
            label="Volcanoes on"
            value={b.volcanoMin}
            onChange={(e) => set({ volcanoMin: e.target.value as BreakInConfig["volcanoMin"] })}
            disabled={!b.reasons.volcano}
            sx={{ width: 220 }}
          >
            <MenuItem value="erupting">Eruptions only</MenuItem>
            <MenuItem value="unrest">Eruptions and unrest</MenuItem>
          </TextField>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Status changes come from a weekly bulletin, so a volcano counts as breaking for 6 hours.
        </Typography>
        {kindOff("volcano", "Volcanoes")}
      </Box>

      <Box sx={rowSx}>
        <Box sx={line}>
          {reason("roundup", "Round-ups")}
          <FormControlLabel
            control={
              <Switch size="small" checked={b.worldRoundup} disabled={!b.reasons.roundup} onChange={(e) => set({ worldRoundup: e.target.checked })} />
            }
            label="World round-up too"
          />
          {b.reasons.roundup && (
            <TuningField
              label="At most one per"
              value={b.roundupCooldownMinutes}
              defaultValue={30}
              min={5}
              max={1440}
              unit="min"
              onChange={(v) => set({ roundupCooldownMinutes: v })}
            />
          )}
        </Box>
        <Typography variant="caption" color="text.secondary">
          A new round-up for one of this channel&apos;s {cfg.countries.length} favourite countries or{" "}
          {cfg.regions.length} favourite areas.
        </Typography>
      </Box>
    </>
  );
}
