"use client";

/**
 * Director: pools & rotation — the POOL bar (what may air at all), how big the
 * event pools get, and how hard the director works to move around the map.
 * The break-in bar on the Break-ins card is a second, higher bar on top of
 * this one. Every edit stages a COMPLETE top-level DirectorConfig field.
 */
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import {
  DEFAULT_DIRECTOR_POOLS,
  DEFAULT_DIRECTOR_ROTATION,
  DIRECTOR_POOLS_BOUNDS,
  DIRECTOR_ROTATION_BOUNDS,
  type DirectorPools,
  type DirectorRotation,
} from "@photonsurge/shared/director-tuning";
import { SEVERITY_LABELS } from "@photonsurge/shared/alerts/severity";
import SettingsCard from "./SettingsCard";
import TuningField from "./TuningField";
import { useSceneDraft } from "./SceneDraft";

const row = { display: "flex", flexWrap: "wrap", gap: 1.5, mb: 1.5 } as const;
/** Pool magnitude choices, M2.0 – M8.0 in half steps. */
export const POOL_MAGNITUDES = Array.from({ length: 13 }, (_, i) => 2 + i * 0.5);
const SEVERITIES = [0, 1, 2, 3, 4] as const;

const POOL_LABELS: Record<keyof DirectorPools, [string, string?]> = {
  alertPoolCap: ["Weather warnings in the pool"],
  alertCountryCap: ["Warnings per country"],
  notableBoost: ["Notable craft score"],
  vipBoost: ["VIP craft score"],
};
const ROTATION_LABELS: Record<keyof DirectorRotation, [string, string?]> = {
  geoCooldownDeg: ["Min distance between shots", "°"],
  recentCentersCap: ["Shots the distance rule remembers"],
  areaMemoryCap: ["Areas each type avoids repeating"],
};

export default function DirectorPoolSettings() {
  const { config: cfg, stageDirector } = useSceneDraft();
  const d = DEFAULT_DIRECTOR_CONFIG;

  const reset = () =>
    stageDirector({
      minQuakeMag: d.minQuakeMag,
      minAlertSeverity: d.minAlertSeverity,
      pools: { ...DEFAULT_DIRECTOR_POOLS },
      rotation: { ...DEFAULT_DIRECTOR_ROTATION },
    });

  return (
    <SettingsCard
      id="director-pools"
      actions={
        <Button size="small" onClick={reset}>
          Reset to defaults
        </Button>
      }
      blurb="What may air at all, and how the director spreads the programme around the world."
    >
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        What may air
      </Typography>
      <Box sx={row}>
        <TextField
          select
          size="small"
          label="Smallest earthquake"
          value={cfg.minQuakeMag}
          onChange={(e) => stageDirector({ minQuakeMag: Number(e.target.value) })}
          helperText={`default M${d.minQuakeMag.toFixed(1)}`}
          sx={{ width: 200 }}
        >
          {[...new Set([...POOL_MAGNITUDES, cfg.minQuakeMag])].sort((a, b) => a - b).map((m) => (
            <MenuItem key={m} value={m}>
              M{m.toFixed(1)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Mildest weather warning"
          value={cfg.minAlertSeverity}
          onChange={(e) => stageDirector({ minAlertSeverity: Number(e.target.value) })}
          helperText={`default ${SEVERITY_LABELS[d.minAlertSeverity as 0]}`}
          sx={{ width: 200 }}
        >
          {SEVERITIES.map((s) => (
            <MenuItem key={s} value={s}>
              {SEVERITY_LABELS[s]}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Pools
      </Typography>
      <Box sx={row}>
        {(Object.keys(POOL_LABELS) as (keyof DirectorPools)[]).map((k) => {
          const [min, max, integer] = DIRECTOR_POOLS_BOUNDS[k];
          return (
            <TuningField
              key={k}
              label={POOL_LABELS[k][0]}
              value={cfg.pools[k]}
              defaultValue={DEFAULT_DIRECTOR_POOLS[k]}
              min={min}
              max={max}
              integer={integer}
              onChange={(v) => stageDirector({ pools: { ...cfg.pools, [k]: v } })}
            />
          );
        })}
      </Box>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Moving around the map
      </Typography>
      <Box sx={row}>
        {(Object.keys(ROTATION_LABELS) as (keyof DirectorRotation)[]).map((k) => {
          const [min, max, integer] = DIRECTOR_ROTATION_BOUNDS[k];
          return (
            <TuningField
              key={k}
              label={ROTATION_LABELS[k][0]}
              unit={ROTATION_LABELS[k][1]}
              value={cfg.rotation[k]}
              defaultValue={DEFAULT_DIRECTOR_ROTATION[k]}
              min={min}
              max={max}
              integer={integer}
              onChange={(v) => stageDirector({ rotation: { ...cfg.rotation, [k]: v } })}
            />
          );
        })}
      </Box>
      <Typography variant="caption" color="text.secondary">
        Craft scores rank catalogued flights and ships against other stories (a severe warning
        scores 86, an M6 quake 100). The distance rule keeps consecutive shots apart; area memory
        stops one country from coming back again and again.
      </Typography>
    </SettingsCard>
  );
}
