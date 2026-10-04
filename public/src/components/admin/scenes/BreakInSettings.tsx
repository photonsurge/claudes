"use client";

/**
 * Director: break-ins — "when a new warning / eruption / quake lands, what does
 * this channel do?". The partner of Pools & rotation: that card holds the bar
 * for what may air at all, this one the bar for what interrupts, and each row
 * prints the pool bar beside its own. Stages the COMPLETE `breakIn` object.
 */
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import type { BreakInConfig } from "@photonsurge/shared/director-break-in";
import SettingsCard from "./SettingsCard";
import BreakInReasonRows from "./BreakInReasonRows";
import TuningField from "./TuningField";
import { useSceneDraft } from "./SceneDraft";

const row = { display: "flex", flexWrap: "wrap", gap: 1.5, mb: 1.5 } as const;
const D = DEFAULT_DIRECTOR_CONFIG.breakIn;

/** The break-in config as it will be saved: the server raises each threshold
 *  to the pool bar, so show the raised value while a pool edit is staged too. */
export function effectiveBreakIn(cfg: { breakIn: BreakInConfig; minQuakeMag: number; minAlertSeverity: number }): BreakInConfig {
  return {
    ...cfg.breakIn,
    minQuakeMag: Math.max(cfg.breakIn.minQuakeMag, cfg.minQuakeMag),
    minAlertSeverity: Math.max(cfg.breakIn.minAlertSeverity, cfg.minAlertSeverity) as BreakInConfig["minAlertSeverity"],
  };
}

export default function BreakInSettings() {
  const { config: cfg, stageDirector } = useSceneDraft();
  const b = effectiveBreakIn(cfg);
  const set = (patch: Partial<BreakInConfig>) => stageDirector({ breakIn: { ...b, ...patch } });
  const off = !b.enabled;

  const num = (key: keyof BreakInConfig, label: string, min: number, max: number, unit?: string, integer = false) => (
    <TuningField
      label={label}
      value={b[key] as number}
      defaultValue={D[key] as number}
      min={min}
      max={max}
      unit={unit}
      integer={integer}
      onChange={(v) => set({ [key]: v } as Partial<BreakInConfig>)}
    />
  );

  return (
    <SettingsCard
      id="director-break-ins"
      actions={
        <Button
          size="small"
          onClick={() =>
            stageDirector({ breakIn: { ...D, minQuakeMag: cfg.minQuakeMag, minAlertSeverity: cfg.minAlertSeverity as BreakInConfig["minAlertSeverity"] } })
          }
        >
          Reset to defaults
        </Button>
      }
      blurb="Cut to something new — a fresh earthquake, a just-issued warning, an eruption — ahead of the normal rotation."
    >
      <FormControlLabel
        control={<Switch checked={b.enabled} onChange={(e) => set({ enabled: e.target.checked })} />}
        label="Cut to breaking events"
        sx={{ mb: 1 }}
      />
      {cfg.mode !== "auto" && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          The director is off on this channel, so nothing breaks in until it is switched to Auto on
          the Control page.
        </Alert>
      )}

      <Box sx={{ opacity: off ? 0.5 : 1, pointerEvents: off ? "none" : undefined }} aria-disabled={off}>
        <Typography variant="subtitle2">When</Typography>
        <RadioGroup
          value={b.interrupt}
          onChange={(e) => set({ interrupt: e.target.value as BreakInConfig["interrupt"] })}
          sx={{ mb: 1 }}
        >
          <FormControlLabel value="boundary" control={<Radio size="small" />} label="At the next shot change" />
          <FormControlLabel value="immediate" control={<Radio size="small" />} label="Interrupt the current shot" />
        </RadioGroup>
        {b.interrupt === "immediate" && (
          <>
            <Box sx={row}>
              {num("guardSeconds", "Never cut a shot younger than", 0, 600, "s")}
              {num("cooldownSeconds", "At most one break-in per", 10, 3600, "s")}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
              A commercial break always finishes first.
            </Typography>
          </>
        )}

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          What breaks in
        </Typography>
        <BreakInReasonRows b={b} cfg={cfg} set={set} />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Freshness and bursts
        </Typography>
        <Box sx={row}>
          {num("windowMinutes", "Breaking for", 1, 1440, "min")}
          {num("clusterMin", "Group a burst of", 0, 10, "events", true)}
          {num("clusterWindowSeconds", "Burst window", 10, 3600, "s")}
          {num("maxPending", "Most waiting at once", 1, 100, undefined, true)}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          An event older than the freshness window is news, not breaking — it still airs through
          normal rotation. Volcanoes use their own 6 hour window. A burst of the same kind airs as
          one cut naming them all (0 turns grouping off).
        </Typography>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          On air
        </Typography>
        <RadioGroup
          row
          value={b.incoming}
          onChange={(e) => set({ incoming: e.target.value as BreakInConfig["incoming"] })}
          aria-label="Incoming reticle"
        >
          <FormControlLabel value="off" control={<Radio size="small" />} label="No incoming reticle" />
          <FormControlLabel value="breakIns" control={<Radio size="small" />} label="Breaking cuts only" />
          <FormControlLabel value="allEvents" control={<Radio size="small" />} label="Every event shot" />
        </RadioGroup>
        {b.incoming !== "off" && <Box sx={{ ...row, mt: 1 }}>{num("incomingSeconds", "Incoming length (0 = flight time)", 0, 15, "s")}</Box>}
      </Box>
    </SettingsCard>
  );
}
