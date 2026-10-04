"use client";

/**
 * Director: pacing — how long shots hold, how long the camera flies between
 * them, and how long each look / field / depth level lasts within a shot.
 * The same hold and transition numbers are live-tweakable on /control; this is
 * the staged, per-channel home for them. Every edit stages a COMPLETE
 * top-level DirectorConfig field.
 */
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import {
  DEFAULT_DIRECTOR_CONFIG,
  DEFAULT_KIND_HOLD_SECONDS,
  DEFAULT_QUAKE_HOLD_SECONDS,
  DEFAULT_STORM_HOLD_SECONDS,
  DEFAULT_VOLCANO_HOLD_SECONDS,
} from "@photonsurge/shared/director";
import { DEFAULT_DIRECTOR_TEMPO, DIRECTOR_TEMPO_BOUNDS } from "@photonsurge/shared/director-tuning";
import SettingsCard from "./SettingsCard";
import DirectorHoldFields from "./DirectorHoldFields";
import TuningField from "./TuningField";
import { useSceneDraft } from "./SceneDraft";

const row = { display: "flex", flexWrap: "wrap", gap: 1.5, mb: 1.5 } as const;
const heading = (text: string) => (
  <Typography variant="subtitle2" sx={{ mb: 1 }}>
    {text}
  </Typography>
);

export default function DirectorPacingSettings() {
  const { sceneId, config: cfg, stageDirector } = useSceneDraft();
  const d = DEFAULT_DIRECTOR_CONFIG;

  const reset = () =>
    stageDirector({
      kindHoldSeconds: { ...DEFAULT_KIND_HOLD_SECONDS },
      quakeHoldSeconds: { ...DEFAULT_QUAKE_HOLD_SECONDS },
      stormHoldSeconds: { ...DEFAULT_STORM_HOLD_SECONDS },
      volcanoHoldSeconds: { ...DEFAULT_VOLCANO_HOLD_SECONDS },
      transitionSeconds: d.transitionSeconds,
      alertCycleSeconds: d.alertCycleSeconds,
      adEveryNShots: d.adEveryNShots,
      tempo: { ...DEFAULT_DIRECTOR_TEMPO },
    });

  const tempo = (key: keyof typeof DEFAULT_DIRECTOR_TEMPO, label: string) => {
    const [min, max] = DIRECTOR_TEMPO_BOUNDS[key];
    return (
      <TuningField
        label={label}
        value={cfg.tempo[key]}
        defaultValue={DEFAULT_DIRECTOR_TEMPO[key]}
        min={min}
        max={max}
        unit="s"
        onChange={(v) => stageDirector({ tempo: { ...cfg.tempo, [key]: v } })}
      />
    );
  };

  return (
    <SettingsCard
      id="director-pacing"
      actions={
        <Button size="small" onClick={reset}>
          Reset to defaults
        </Button>
      }
      blurb={
        <>
          How fast the programme moves. The same holds and transition can be nudged live on the{" "}
          <Link href={`/control?scene=${encodeURIComponent(sceneId)}`}>Control page</Link>; this is
          the channel&apos;s saved setting.
        </>
      }
    >
      {heading("How long each shot holds")}
      <DirectorHoldFields cfg={cfg} stage={stageDirector} />

      {heading("Between shots")}
      <Box sx={row}>
        <TuningField
          label="Camera flight"
          value={cfg.transitionSeconds}
          defaultValue={d.transitionSeconds}
          min={0.5}
          max={30}
          unit="s"
          onChange={(v) => stageDirector({ transitionSeconds: v })}
        />
        <TuningField
          label="Hazard cycle beat"
          value={cfg.alertCycleSeconds}
          defaultValue={d.alertCycleSeconds}
          min={2}
          max={60}
          unit="s"
          onChange={(v) => stageDirector({ alertCycleSeconds: v })}
        />
        {cfg.kinds.ad && (
          <TuningField
            label="Ad break every"
            value={cfg.adEveryNShots}
            defaultValue={d.adEveryNShots}
            min={1}
            max={50}
            integer
            unit="shots"
            onChange={(v) => stageDirector({ adEveryNShots: v })}
          />
        )}
      </Box>

      {heading("Within a shot")}
      <Box sx={row}>
        {tempo("mapStepS", "Each map look")}
        {tempo("varCycleS", "Each weather field")}
        {tempo("depthCycleS", "Each ocean depth")}
      </Box>
      <Typography variant="caption" color="text.secondary">
        A global or ocean spin steps through several map looks; a country or area cycles weather
        fields; a monitoring point steps down through ocean depths. Tour stops are paced on the
        Tours &amp; round-ups card.
      </Typography>
    </SettingsCard>
  );
}
