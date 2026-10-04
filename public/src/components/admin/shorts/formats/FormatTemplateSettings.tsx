"use client";

/**
 * Template card — what Generate starts from in this format (§5.2 `template`):
 * the format's name, the scope (a country, an area, the globe, several places
 * in order — the ordered list editor with its "Main areas" quick-fill — or
 * none so Generate asks), the event switches (ignored for several places:
 * that video is round-up only), the length budget and, for videos of
 * several places, whether the world round-up opens it. A Generate request can
 * still override any of it. Stages whole `name` / `template` fields.
 */
import Alert from "@mui/material/Alert";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { ShortFormat } from "@photonsurge/shared/short-format";
import { FORMAT_BUDGET_MAX_MS, FORMAT_BUDGET_MIN_MS } from "@photonsurge/shared/short-format";
import { DEFAULT_SHORT_BUDGET_MS, type ShortInclude, type ShortScope } from "@photonsurge/shared/short-script";
import SettingsCard from "../../scenes/SettingsCard";
import TuningField from "../../scenes/TuningField";
import { useSceneDraft } from "../../scenes/SceneDraft";
import { AREA_OPTIONS, COUNTRY_OPTIONS } from "../../../../lib/shorts";
import PlacesEditor from "../PlacesEditor";

type ScopeChoice = "none" | ShortScope["type"];

const INCLUDE: { key: keyof ShortInclude; label: string }[] = [
  { key: "alerts", label: "Alerts" },
  { key: "quakes", label: "Earthquakes" },
  { key: "volcanoes", label: "Volcanoes" },
];

export default function FormatTemplateSettings() {
  const { format, stageFormat } = useSceneDraft();
  if (!format) return null;
  const t = format.template;
  const setTemplate = (over: Partial<ShortFormat["template"]>) => stageFormat({ template: { ...t, ...over } });

  const choice: ScopeChoice = t.scope?.type ?? "none";
  const pickType = (type: ScopeChoice) => {
    if (type === "none") setTemplate({ scope: undefined });
    else if (type === "globe") setTemplate({ scope: { type: "globe" } });
    else if (type === "places") setTemplate({ scope: { type: "places", places: t.scope?.type === "places" ? t.scope.places : [] } });
    else {
      const options = type === "country" ? COUNTRY_OPTIONS : AREA_OPTIONS;
      const keep = t.scope && t.scope.type === type ? t.scope.id : options[0]?.id ?? "";
      setTemplate({ scope: { type, id: keep } });
    }
  };
  const placeOptions = choice === "country" ? COUNTRY_OPTIONS : AREA_OPTIONS;
  const placeId = t.scope && (t.scope.type === "country" || t.scope.type === "area") ? t.scope.id : "";

  return (
    <SettingsCard
      id="template"
      blurb="What Generate starts from in this format. A request on the Generate form can still pick another place."
    >
      <Stack spacing={2}>
        <TextField
          size="small"
          label="Format name"
          value={format.name}
          onChange={(e) => stageFormat({ name: e.target.value })}
          helperText="Shown in the format pickers, and as the %{format} code."
          sx={{ maxWidth: 420 }}
        />

        <div>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Scope
          </Typography>
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={choice}
              onChange={(_e, v: ScopeChoice | null) => v && pickType(v)}
              aria-label="Scope"
            >
              <ToggleButton value="none">Ask at Generate</ToggleButton>
              <ToggleButton value="globe">Globe</ToggleButton>
              <ToggleButton value="area">Area</ToggleButton>
              <ToggleButton value="country">Country</ToggleButton>
              <ToggleButton value="places">Several places</ToggleButton>
            </ToggleButtonGroup>
            {(choice === "area" || choice === "country") && (
              <TextField
                select
                size="small"
                label={choice === "country" ? "Country" : "Area"}
                value={placeOptions.some((o) => o.id === placeId) ? placeId : ""}
                onChange={(e) => setTemplate({ scope: { type: choice, id: e.target.value } })}
                sx={{ minWidth: 260 }}
              >
                {placeOptions.map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
          {t.scope?.type === "places" && (
            <Stack sx={{ mt: 1.5 }}>
              <PlacesEditor
                places={t.scope.places}
                onChange={(places) => setTemplate({ scope: { type: "places", places } })}
              />
              {!t.scope.places.length && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  Add at least one place. Save is blocked until you do.
                </Alert>
              )}
            </Stack>
          )}
        </div>

        <div>
          <Typography variant="subtitle2">Events</Typography>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.5 }}>
            Event clips after the round-up. Round-up videos ship first; leave these off until event clips are in
            use.
          </Typography>
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
            {INCLUDE.map(({ key, label }) => (
              <FormControlLabel
                key={key}
                control={
                  <Switch
                    size="small"
                    checked={t.include[key]}
                    onChange={(e) => setTemplate({ include: { ...t.include, [key]: e.target.checked } })}
                  />
                }
                label={label}
              />
            ))}
          </Stack>
        </div>

        <TuningField
          label="Length budget"
          value={t.budgetMs / 1000}
          defaultValue={DEFAULT_SHORT_BUDGET_MS / 1000}
          min={FORMAT_BUDGET_MIN_MS / 1000}
          max={FORMAT_BUDGET_MAX_MS / 1000}
          unit="s"
          onChange={(v) => setTemplate({ budgetMs: Math.round(v * 1000) })}
        />

        <FormControlLabel
          control={<Switch checked={t.openWithWorld} onChange={(e) => setTemplate({ openWithWorld: e.target.checked })} />}
          label="Open on the world round-up (videos of several places)"
        />
      </Stack>
    </SettingsCard>
  );
}
