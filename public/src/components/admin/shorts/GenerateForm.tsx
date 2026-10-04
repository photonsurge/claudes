"use client";

/**
 * Generate a round-up — the format to make it in (default the default
 * format; the format's own scene tunes it and plays it), the scope picker
 * (Globe / Area / Country, then the area or country from the shared catalogs;
 * or Several places, an ordered list of countries and areas with "world
 * round-up first", which starts from the format's setting) and the Generate
 * button. A several-places result names the places it left out. The
 * worker builds the script; while it runs the form shows progress, a failure
 * shows the worker's own message (it says what to fix), and a success hands
 * the new script id up so the page selects it. Render (§6.1, §6.6) opens the
 * Render form for the same format and scope instead: the video is generated
 * when it reaches the front of its encoder's queue, from the data current then.
 *
 * The event switches (alerts / quakes / volcanoes) are a later package: they
 * slot in as an `include` row under the scope, and `request` already carries
 * `include` for them.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { ShortInclude, ShortPlace, ShortScope } from "@photonsurge/shared/short-script";
import { DEFAULT_SHORT_FORMAT_ID } from "@photonsurge/shared/short-scenes";
import {
  AREA_OPTIONS,
  COUNTRY_OPTIONS,
  formatDuration,
  generateShort,
  type GenerateShortRequest,
  type GenerateShortResult,
} from "../../../lib/shorts";
import PlacesEditor from "./PlacesEditor";

type ScopeType = ShortScope["type"];

/** Round-up only — every event switch off (the first release). */
const ROUNDUP_ONLY: ShortInclude = { alerts: false, quakes: false, volcanoes: false };

interface Props {
  /** Called with the saved draft once the worker returns it. */
  onGenerated: (result: GenerateShortResult) => void;
  /** The formats to pick from; the default format when empty. */
  formats?: { id: string; name: string; openWithWorld?: boolean }[];
  /** Opens the Render form for this format and scope (absent = no Render button). */
  onRender?: (req: { formatId: string; scope: ShortScope; include: ShortInclude }) => void;
  /** Injectable for tests. */
  generate?: typeof generateShort;
}

export default function GenerateForm({ onGenerated, onRender, formats = [], generate = generateShort }: Props) {
  const [formatId, setFormatId] = useState<string>(DEFAULT_SHORT_FORMAT_ID);
  const [type, setType] = useState<ScopeType>("globe");
  const [countryId, setCountryId] = useState(COUNTRY_OPTIONS[0]?.id ?? "");
  const [areaId, setAreaId] = useState(AREA_OPTIONS[0]?.id ?? "");
  const [places, setPlaces] = useState<ShortPlace[]>([]);
  const [openWithWorld, setOpenWithWorld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<GenerateShortResult["skipped"]>(undefined);

  // "World round-up first" starts from the picked format's own setting.
  const formatWorld = formats.find((f) => f.id === formatId)?.openWithWorld === true;
  useEffect(() => setOpenWithWorld(formatWorld), [formatId, formatWorld]);

  const scope: ShortScope =
    type === "globe"
      ? { type: "globe" }
      : type === "places"
        ? { type: "places", places }
        : { type, id: type === "country" ? countryId : areaId };
  const request: GenerateShortRequest = {
    formatId,
    scope,
    include: ROUNDUP_ONLY,
    ...(type === "places" ? { openWithWorld } : {}),
  };
  const ready = type === "globe" || (type === "places" ? places.length > 0 : !!(type === "country" ? countryId : areaId));

  const submit = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    setSkipped(undefined);
    const res = await generate(request);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(`Saved “${res.data.title}” — ${res.data.clips} clip(s), ${formatDuration(res.data.durationMs)}.`);
    setSkipped(res.data.skipped?.length ? res.data.skipped : undefined);
    onGenerated(res.data);
  };

  const options = type === "country" ? COUNTRY_OPTIONS : AREA_OPTIONS;
  const placeValue = type === "country" ? countryId : areaId;

  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        Generate a round-up
      </Typography>
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ mt: 1, alignItems: "center", flexWrap: "wrap" }}>
        {formats.length > 1 && (
          <TextField
            select
            size="small"
            label="Format"
            value={formats.some((f) => f.id === formatId) ? formatId : DEFAULT_SHORT_FORMAT_ID}
            onChange={(e) => setFormatId(e.target.value)}
            disabled={busy}
            sx={{ minWidth: 200 }}
          >
            {formats.map((f) => (
              <MenuItem key={f.id} value={f.id}>
                {f.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        <ToggleButtonGroup
          exclusive
          size="small"
          value={type}
          onChange={(_e, v: ScopeType | null) => v && setType(v)}
          aria-label="Scope"
          disabled={busy}
        >
          <ToggleButton value="globe">Globe</ToggleButton>
          <ToggleButton value="area">Area</ToggleButton>
          <ToggleButton value="country">Country</ToggleButton>
          <ToggleButton value="places">Several places</ToggleButton>
        </ToggleButtonGroup>
        {(type === "country" || type === "area") && (
          <TextField
            select
            size="small"
            label={type === "country" ? "Country" : "Area"}
            value={placeValue}
            onChange={(e) => (type === "country" ? setCountryId(e.target.value) : setAreaId(e.target.value))}
            disabled={busy}
            sx={{ minWidth: 260 }}
          >
            {options.map((o) => (
              <MenuItem key={o.id} value={o.id}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Button variant="contained" onClick={submit} disabled={busy || !ready}>
          {busy ? "Generating…" : "Generate"}
        </Button>
        {onRender && (
          <Button
            variant="outlined"
            onClick={() => onRender({ formatId, scope, include: ROUNDUP_ONLY })}
            disabled={busy || !ready}
            title="Queue a video that generates this round-up when it reaches the front of the queue"
          >
            Render…
          </Button>
        )}
      </Stack>
      {type === "places" && (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          <PlacesEditor places={places} onChange={setPlaces} disabled={busy} />
          <FormControlLabel
            control={<Switch checked={openWithWorld} onChange={(e) => setOpenWithWorld(e.target.checked)} disabled={busy} />}
            label="Open on the world round-up"
          />
          {onRender && (
            <Typography variant="caption" color="text.secondary">
              Render… uses the format&apos;s own world round-up setting.
            </Typography>
          )}
        </Stack>
      )}
      {busy && (
        <Stack spacing={0.75} sx={{ mt: 1.5 }}>
          <LinearProgress aria-label="Generating" />
          <Typography variant="caption" color="text.secondary">
            The worker is building the script from the live round-up…
          </Typography>
        </Stack>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      )}
      {done && !error && (
        <Alert severity="success" sx={{ mt: 1.5 }}>
          {done}
        </Alert>
      )}
      {skipped && !error && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          Left out: {skipped.map((p) => `${p.name} (${p.reason})`).join(", ")}.
        </Alert>
      )}
    </Paper>
  );
}
