"use client";

/**
 * Director: tours & round-ups — how many stops a country or area tour flies,
 * how long the camera parks on each, and how round-ups are paced. Stages the
 * COMPLETE `tours` object.
 */
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import {
  DEFAULT_DIRECTOR_TOURS,
  DIRECTOR_TOURS_BOUNDS,
  type DirectorTours,
} from "@photonsurge/shared/director-tuning";
import SettingsCard from "./SettingsCard";
import TuningField from "./TuningField";
import { useSceneDraft } from "./SceneDraft";

const row = { display: "flex", flexWrap: "wrap", gap: 1.5, mb: 1.5 } as const;

const SECTIONS: { title: string; fields: { key: keyof DirectorTours; label: string; unit?: string }[] }[] = [
  {
    title: "Tours",
    fields: [
      { key: "countryStops", label: "Stops on a country tour" },
      { key: "regionStops", label: "Countries on an area tour" },
      { key: "stopDwellS", label: "Time at each stop", unit: "s" },
    ],
  },
  {
    title: "Round-ups",
    fields: [
      { key: "roundupStops", label: "Stops a round-up covers" },
      { key: "roundupWordsPerMin", label: "Reading pace", unit: "wpm" },
      { key: "roundupMaxHoldS", label: "Longest round-up without stops", unit: "s" },
    ],
  },
  {
    title: "Framing",
    fields: [{ key: "volcanoZoom", label: "Volcano zoom" }],
  },
];

export default function DirectorTourSettings() {
  const { config: cfg, stageDirector } = useSceneDraft();

  return (
    <SettingsCard
      id="director-tours"
      actions={
        <Button size="small" onClick={() => stageDirector({ tours: { ...DEFAULT_DIRECTOR_TOURS } })}>
          Reset to defaults
        </Button>
      }
      blurb="A tour's shot lasts as long as it takes to fly every stop, so more stops or a longer stop time means a longer shot."
    >
      {SECTIONS.map((section) => (
        <Box key={section.title}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {section.title}
          </Typography>
          <Box sx={row}>
            {section.fields.map(({ key, label, unit }) => {
              const [min, max, integer] = DIRECTOR_TOURS_BOUNDS[key];
              return (
                <TuningField
                  key={key}
                  label={label}
                  unit={unit}
                  value={cfg.tours[key]}
                  defaultValue={DEFAULT_DIRECTOR_TOURS[key]}
                  min={min}
                  max={max}
                  integer={integer}
                  onChange={(v) => stageDirector({ tours: { ...cfg.tours, [key]: v } })}
                />
              );
            })}
          </Box>
        </Box>
      ))}
      <Typography variant="caption" color="text.secondary">
        Round-ups are the generated world summaries that ride the global spin. A round-up with
        stops dwells at each one; without stops it holds for its reading time, up to the limit
        above.
      </Typography>
    </SettingsCard>
  );
}
