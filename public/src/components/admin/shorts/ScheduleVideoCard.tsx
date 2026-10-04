"use client";

/**
 * One video of a schedule's batch, in the schedule editor
 * (docs/short-video-plan.md §8): its format; what it makes — a template with
 * a scope (globe, an area, a country, or "auto": the busiest country or
 * area when it runs) or a saved script; the event switches (absent = the
 * format's); the round-up freshness rule; skip-if-quiet; and its YouTube
 * overrides (title, publish as) with the resolved title preview the format
 * editor uses. For a fixed country or area it says when that place's
 * round-up is next written (London time), and how old it will be when the
 * schedule runs, so the operator can put the video after it.
 */
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { RoundupSettings } from "@photonsurge/shared/roundup-settings";
import type { YoutubePrivacy } from "@photonsurge/shared/runs";
import type { ShortFormat } from "@photonsurge/shared/short-format";
import type { ShortAutoScope } from "@photonsurge/shared/short-render";
import { shortPlaceName, type ShortInclude, type ShortScope } from "@photonsurge/shared/short-script";
import VideoTextField from "./formats/VideoTextField";
import { exampleVideoValues } from "../../../lib/short-formats";
import { AREA_OPTIONS, COUNTRY_OPTIONS, scopeLabel, type ShortListItem } from "../../../lib/shorts";
import { fmtInZone, LONDON, roundupSlotHints, type DraftVideo, type RoundupSlotHint } from "../../../lib/short-schedules";
import PlacesEditor from "./PlacesEditor";

type ScopeKind = "globe" | "area" | "country" | "places" | "auto";
const NO_EVENTS: ShortInclude = { alerts: false, quakes: false, volcanoes: false };
const INCLUDE_KEYS: { key: keyof ShortInclude; label: string }[] = [
  { key: "alerts", label: "Alerts" },
  { key: "quakes", label: "Quakes" },
  { key: "volcanoes", label: "Volcanoes" },
];

const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
const joinHours = (hours: number[]) => {
  const t = hours.map(pad);
  return t.length < 2 ? t.join("") : `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`;
};

export interface ScheduleVideoCardProps {
  video: DraftVideo;
  index: number;
  count: number;
  formats: { id: string; name: string }[];
  scripts: Pick<ShortListItem, "id" | "title" | "formatId">[];
  /** The video's format, once loaded: its title, privacy and switches are the defaults shown. */
  format: ShortFormat | null;
  /** The round-up settings (null until loaded, or when they can't be). */
  settings: RoundupSettings | null;
  /** When the schedule next runs (null when it can't be worked out). */
  runAt: number | null;
  now: number;
  error?: string;
  disabled?: boolean;
  onChange: (v: DraftVideo) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

export default function ScheduleVideoCard({
  video,
  index,
  count,
  formats,
  scripts,
  format,
  settings,
  runAt,
  now,
  error,
  disabled,
  onChange,
  onMove,
  onRemove,
}: ScheduleVideoCardProps) {
  const what = video.what;
  const isTemplate = what.type === "template";
  const scope = what.type === "template" ? what.scope : undefined;
  const kind: ScopeKind = scope?.type ?? "globe";
  const include = what.type === "template" ? what.include : undefined;
  const effectiveInclude = include ?? format?.template.include ?? NO_EVENTS;
  const anyEvents = INCLUDE_KEYS.some((k) => effectiveInclude[k.key]);

  const set = (patch: Partial<DraftVideo>) => onChange({ ...video, ...patch });
  const setWhat = (w: DraftVideo["what"]) => {
    const next: DraftVideo = { ...video, what: w };
    // skip-if-quiet only means something with an event switch on.
    const inc = w.type === "template" ? (w.include ?? format?.template.include ?? NO_EVENTS) : NO_EVENTS;
    if (!INCLUDE_KEYS.some((k) => inc[k.key])) delete next.skipIfQuiet;
    onChange(next);
  };
  const setScope = (s: ShortScope | ShortAutoScope) =>
    setWhat({ type: "template", scope: s, ...(include ? { include } : {}) });
  const setVideoOverride = (patch: Partial<NonNullable<DraftVideo["video"]>>) => {
    const v = { ...(video.video ?? {}), ...patch };
    for (const k of Object.keys(v) as (keyof typeof v)[]) if (v[k] === undefined) delete v[k];
    const next: DraftVideo = { ...video, video: v };
    if (!Object.keys(v).length) delete next.video;
    onChange(next);
  };

  const pickKind = (k: ScopeKind) => {
    if (k === "globe") setScope({ type: "globe" });
    else if (k === "auto") setScope({ type: "auto", of: "country" });
    else if (k === "places") setScope({ type: "places", places: [] });
    else if (k === "area") setScope({ type: "area", id: AREA_OPTIONS[0]?.id ?? "" });
    else setScope({ type: "country", id: COUNTRY_OPTIONS[0]?.id ?? "" });
  };

  // The title preview's values: examples, with what is known of the place.
  const values = exampleVideoValues();
  if (format) values.format = format.name;
  if (scope?.type === "globe") values.place = "World";
  else if (scope?.type === "places") values.place = scope.places.map(shortPlaceName).join(", ") || values.place;
  else if (scope && scope.type !== "auto") values.place = shortPlaceName(scope);

  const hints = roundupSlotHints(scope, settings, now, runAt);
  const formatTitle = format?.video.title ?? "";
  const title = video.video?.title ?? formatTitle;
  const formatName = formats.find((f) => f.id === video.formatId)?.name ?? video.formatId;

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-testid={`video-${index}`}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
            {index + 1}. {isTemplate ? (scope ? scopeName(scope) : "") : "Saved script"} · {formatName}
          </Typography>
          <Button size="small" aria-label={`Move video ${index + 1} up`} disabled={disabled || index === 0} onClick={() => onMove(-1)}>
            ↑
          </Button>
          <Button
            size="small"
            aria-label={`Move video ${index + 1} down`}
            disabled={disabled || index === count - 1}
            onClick={() => onMove(1)}
          >
            ↓
          </Button>
          <Button size="small" color="error" aria-label={`Remove video ${index + 1}`} disabled={disabled} onClick={onRemove}>
            Remove
          </Button>
        </Stack>

        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <TextField
            select
            size="small"
            label="Format"
            value={formats.some((f) => f.id === video.formatId) ? video.formatId : ""}
            onChange={(e) => set({ formatId: e.target.value })}
            disabled={disabled}
            sx={{ minWidth: 200 }}
          >
            {formats.map((f) => (
              <MenuItem key={f.id} value={f.id}>
                {f.name}
              </MenuItem>
            ))}
          </TextField>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={what.type}
            aria-label="What"
            disabled={disabled}
            onChange={(_e, v: "template" | "script" | null) => {
              if (v === "template") setWhat({ type: "template", scope: { type: "globe" } });
              if (v === "script") setWhat({ type: "script", scriptId: "" });
            }}
          >
            <ToggleButton value="template">Template</ToggleButton>
            <ToggleButton value="script">Saved script</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        {isTemplate ? (
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={kind}
              aria-label="Scope"
              disabled={disabled}
              onChange={(_e, v: ScopeKind | null) => v && pickKind(v)}
            >
              <ToggleButton value="globe">Globe</ToggleButton>
              <ToggleButton value="area">Area</ToggleButton>
              <ToggleButton value="country">Country</ToggleButton>
              <ToggleButton value="places">Several places</ToggleButton>
              <ToggleButton value="auto">Auto</ToggleButton>
            </ToggleButtonGroup>
            {(kind === "area" || kind === "country") && scope && "id" in scope && (
              <TextField
                select
                size="small"
                label={kind === "country" ? "Country" : "Area"}
                value={scope.id}
                onChange={(e) => setScope({ type: kind, id: e.target.value })}
                disabled={disabled}
                sx={{ minWidth: 240 }}
              >
                {(kind === "country" ? COUNTRY_OPTIONS : AREA_OPTIONS).map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {kind === "auto" && scope?.type === "auto" && (
              <TextField
                select
                size="small"
                label="Auto"
                value={scope.of}
                onChange={(e) => setScope({ type: "auto", of: e.target.value as "country" | "area" })}
                disabled={disabled}
                sx={{ minWidth: 240 }}
                helperText="Picked when it runs: the most going on, skipping recent picks."
              >
                <MenuItem value="country">Busiest country</MenuItem>
                <MenuItem value="area">Busiest area</MenuItem>
              </TextField>
            )}
          </Stack>
        ) : (
          <TextField
            select
            size="small"
            label="Script"
            value={what.type === "script" ? what.scriptId : ""}
            onChange={(e) => {
              const s = scripts.find((x) => x.id === e.target.value);
              onChange({ ...video, formatId: s?.formatId ?? video.formatId, what: { type: "script", scriptId: e.target.value } });
            }}
            disabled={disabled}
            helperText="A saved script plays the same clips every time; a template makes a fresh one from the data then."
          >
            {scripts.length === 0 && (
              <MenuItem value="" disabled>
                No saved scripts
              </MenuItem>
            )}
            {scripts.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.title}
              </MenuItem>
            ))}
          </TextField>
        )}

        {isTemplate && (
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={!include}
                  disabled={disabled}
                  onChange={(e) =>
                    setWhat(
                      e.target.checked
                        ? { type: "template", scope: scope! }
                        : { type: "template", scope: scope!, include: { ...(format?.template.include ?? NO_EVENTS) } },
                    )
                  }
                />
              }
              label="The format's event switches"
            />
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              {INCLUDE_KEYS.map((k) => (
                <FormControlLabel
                  key={k.key}
                  control={
                    <Switch
                      size="small"
                      checked={effectiveInclude[k.key]}
                      disabled={disabled || !include}
                      onChange={(e) => setWhat({ type: "template", scope: scope!, include: { ...effectiveInclude, [k.key]: e.target.checked } })}
                    />
                  }
                  label={k.label}
                />
              ))}
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={!!video.skipIfQuiet && anyEvents}
                    disabled={disabled || !anyEvents}
                    onChange={(e) => {
                      const next = { ...video };
                      if (e.target.checked) next.skipIfQuiet = true;
                      else delete next.skipIfQuiet;
                      onChange(next);
                    }}
                  />
                }
                label="Skip if quiet"
                title="Make no video when nothing is active in the scope (needs an event switch on)"
              />
            </Stack>
          </Box>
        )}

        {isTemplate && (
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "flex-start" }}>
            <TextField
              size="small"
              type="number"
              label="Round-up no older than (h)"
              value={Number.isFinite(video.roundup.maxAgeHours) ? video.roundup.maxAgeHours : ""}
              onChange={(e) => set({ roundup: { ...video.roundup, maxAgeHours: e.target.value === "" ? NaN : Number(e.target.value) } })}
              disabled={disabled}
              slotProps={{ htmlInput: { min: 1, max: 336 } }}
              sx={{ width: 210 }}
            />
            <TextField
              select
              size="small"
              label="If older"
              value={video.roundup.ifStale}
              onChange={(e) => set({ roundup: { ...video.roundup, ifStale: e.target.value as "refresh" | "skip" } })}
              disabled={disabled}
              sx={{ minWidth: 220 }}
              helperText={
                kind === "globe" && video.roundup.ifStale === "refresh"
                  ? "The world round-up can't be refreshed: a stale one fails the video."
                  : undefined
              }
            >
              <MenuItem value="refresh">Refresh it first (one LLM call)</MenuItem>
              <MenuItem value="skip">Skip the video</MenuItem>
            </TextField>
          </Stack>
        )}

        {isTemplate && scope?.type === "places" && (
          <PlacesEditor places={scope.places} onChange={(places) => setScope({ type: "places", places })} disabled={disabled} />
        )}

        {hints.length === 1 && <SlotHint hint={hints[0]} maxAgeHours={video.roundup.maxAgeHours} ifStale={video.roundup.ifStale} />}
        {hints.length > 1 && <PlacesSlotHints hints={hints} maxAgeHours={video.roundup.maxAgeHours} ifStale={video.roundup.ifStale} />}

        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
          <TextField
            select
            size="small"
            label="Publish as"
            value={video.video?.publishAs ?? ""}
            onChange={(e) => setVideoOverride({ publishAs: (e.target.value || undefined) as YoutubePrivacy | undefined })}
            disabled={disabled}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">As the format says{format ? ` (${format.video.publishAs})` : ""}</MenuItem>
            <MenuItem value="public">Public</MenuItem>
            <MenuItem value="unlisted">Unlisted</MenuItem>
            <MenuItem value="private">Private</MenuItem>
          </TextField>
        </Stack>
        {format ? (
          <Box>
            <VideoTextField
              kind="title"
              value={title}
              onChange={(t) => setVideoOverride({ title: t === formatTitle ? undefined : t })}
              values={values}
              valuesNote="example values until it generates"
              timezone={video.video?.timezone ?? format.video.timezone}
            />
            {video.video?.title !== undefined && (
              <Button size="small" onClick={() => setVideoOverride({ title: undefined })} disabled={disabled}>
                Use the format&apos;s title
              </Button>
            )}
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">
            Loading the format&apos;s YouTube settings…
          </Typography>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Paper>
  );
}

function scopeName(scope: ShortScope | ShortAutoScope): string {
  if (scope.type === "auto") return scope.of === "country" ? "Busiest country" : "Busiest area";
  if (scope.type === "places") return `${scope.places.length} place${scope.places.length === 1 ? "" : "s"}`;
  return scopeLabel(scope).replace(/^\w+ · /, "");
}

function SlotHint({
  hint,
  maxAgeHours,
  ifStale,
}: {
  hint: RoundupSlotHint;
  maxAgeHours: number;
  ifStale: "refresh" | "skip";
}) {
  if (hint.state === "off") {
    return (
      <Alert severity="info" data-testid="slot-hint">
        {hint.kind === "country" ? "Country" : "Area"} round-ups are off on a schedule (/admin/place-roundups), so{" "}
        {hint.place}&apos;s is only as fresh as its last manual run — this video will{" "}
        {ifStale === "refresh" ? "refresh it when it runs" : "be skipped when it's too old"}.
      </Alert>
    );
  }
  const stale = hint.beforeRun && hint.beforeRun.ageHours > maxAgeHours;
  return (
    <Alert severity={stale ? "warning" : "info"} data-testid="slot-hint">
      {hint.place}&apos;s round-up is written at {joinHours(hint.hours)} local; next {fmtInZone(hint.nextAt, LONDON)} London.
      {hint.beforeRun && (
        <>
          {" "}
          At this schedule&apos;s next run the latest is from {fmtInZone(hint.beforeRun.at, LONDON)} London,{" "}
          {hint.beforeRun.ageHours.toFixed(1).replace(/\.0$/, "")} h old
          {stale ? ` — over the ${maxAgeHours} h limit, so it will be ${ifStale === "refresh" ? "refreshed" : "skipped"}.` : "."}
        </>
      )}
    </Alert>
  );
}

/** A several-places video: one line per place — when its round-up is next written, and its age at the run. */
function PlacesSlotHints({
  hints,
  maxAgeHours,
  ifStale,
}: {
  hints: RoundupSlotHint[];
  maxAgeHours: number;
  ifStale: "refresh" | "skip";
}) {
  const stale = hints.filter((h) => h.state === "off" || (h.beforeRun && h.beforeRun.ageHours > maxAgeHours));
  return (
    <Alert severity={stale.length ? "warning" : "info"} data-testid="slot-hint">
      Each place&apos;s round-up, in London time:
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {hints.map((h, i) => (
          <li key={i}>
            {h.state === "off"
              ? `${h.place}: off on a schedule`
              : `${h.place}: next ${fmtInZone(h.nextAt, LONDON)}${
                  h.beforeRun ? ` · ${h.beforeRun.ageHours.toFixed(1).replace(/\.0$/, "")} h old at the next run` : ""
                }`}
          </li>
        ))}
      </Box>
      {stale.length > 0 &&
        `${stale.length} over the ${maxAgeHours} h limit (or unscheduled) — ${ifStale === "refresh" ? "refreshed one by one before it generates" : "the video is skipped"}.`}
    </Alert>
  );
}
