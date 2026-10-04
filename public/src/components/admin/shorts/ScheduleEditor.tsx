"use client";

/**
 * The schedule editor (docs/short-video-plan.md §8, §6.1): the Render form's
 * choices for a whole batch plus a repeat picker.
 *
 *  - Name.
 *  - Repeat: Once at a date and time, or Weekly — day chips, a time, and the
 *    IANA zone the time is in (validated; default Europe/London).
 *  - Encoder: the video-mode EncoderSelect (video encoders first, "Any video
 *    encoder", then channel encoders, each with what it is doing).
 *  - YouTube channel, Offline test, the start-by window (a video not started
 *    this long after the schedule's time is skipped as too late).
 *  - The videos, in order (ScheduleVideoCard): add, remove, move up / down.
 *
 * It warns, without blocking, when the schedule runs in the last hour of the
 * YouTube quota day (§13: the quota resets at midnight Pacific, 08:00
 * London) — the batch would spend the reserve the live channels need.
 */
import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { RoundupSettings } from "@photonsurge/shared/roundup-settings";
import type { ShortFormat } from "@photonsurge/shared/short-format";
import { nextFireAt, type ShortSchedule } from "@photonsurge/shared/short-schedule";
import { DEFAULT_SHORT_FORMAT_ID } from "@photonsurge/shared/short-scenes";
import EncoderSelect from "../streams/EncoderSelect";
import ScheduleVideoCard from "./ScheduleVideoCard";
import { fetchRenderOptions, getShortFormat } from "../../../lib/short-formats";
import { defaultRenderEncoder, type EncoderWithOccupancy } from "../../../lib/renders";
import { getRoundupSettings } from "../../../lib/roundupSettings";
import type { ShortListItem } from "../../../lib/shorts";
import type { StreamAccount } from "../../../lib/stream";
import {
  createSchedule,
  describeNextRun,
  draftFromSchedule,
  draftToInput,
  draftWhen,
  fmtInZone,
  hasErrors,
  LONDON,
  moveItem,
  newDraftVideo,
  quotaHourFire,
  quotaResetLondon,
  saveSchedule,
  timeZoneOptions,
  validateDraft,
  WEEK,
  type ScheduleDraft,
} from "../../../lib/short-schedules";

export interface ScheduleEditorProps {
  open: boolean;
  /** The schedule to edit; null = a new one. */
  schedule: ShortSchedule | null;
  /** A new schedule's starting point (the Morning batch quick start). */
  preset?: ScheduleDraft;
  onClose: () => void;
  onSaved: (s: ShortSchedule) => void;
  formats?: { id: string; name: string }[];
  scripts?: Pick<ShortListItem, "id" | "title" | "formatId">[];
  /** Injectable for tests. */
  loadOptions?: () => Promise<{ encoders: EncoderWithOccupancy[]; accounts: StreamAccount[] }>;
  loadSettings?: () => Promise<{ settings: RoundupSettings }>;
  loadFormat?: typeof getShortFormat;
  create?: typeof createSchedule;
  save?: typeof saveSchedule;
  now?: () => number;
}

export default function ScheduleEditor({
  open,
  schedule,
  preset,
  onClose,
  onSaved,
  formats = [],
  scripts = [],
  loadOptions = fetchRenderOptions,
  loadSettings = getRoundupSettings,
  loadFormat = getShortFormat,
  create = createSchedule,
  save = saveSchedule,
  now = Date.now,
}: ScheduleEditorProps) {
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftFromSchedule(schedule, now()));
  const [encoders, setEncoders] = useState<EncoderWithOccupancy[]>([]);
  const [accounts, setAccounts] = useState<StreamAccount[]>([]);
  const [settings, setSettings] = useState<RoundupSettings | null>(null);
  const [formatById, setFormatById] = useState<Record<string, ShortFormat>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const zones = useMemo(() => timeZoneOptions(), []);

  // Reset the form and load what it picks from each time it opens.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setDraft(preset ?? draftFromSchedule(schedule, now()));
    setError(null);
    setTouched(false);
    loadOptions()
      .then((o) => {
        if (!live) return;
        setEncoders(o.encoders);
        setAccounts(o.accounts);
        // A new schedule starts on the first free video encoder, as the Render form does.
        if (!schedule) setDraft((d) => ({ ...d, encoderId: defaultRenderEncoder(o.encoders) }));
      })
      .catch(() => {});
    loadSettings()
      .then((r) => live && setSettings(r.settings))
      .catch(() => live && setSettings(null));
    return () => {
      live = false;
    };
    // The loaders are stable props; `schedule`/`preset` are read when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schedule?.id, preset]);

  // Load each video's format once (its title, privacy and switches are the defaults shown).
  const formatIds = [...new Set(draft.videos.map((v) => v.formatId))].filter(Boolean).join(",");
  useEffect(() => {
    if (!open) return;
    for (const id of formatIds.split(",").filter(Boolean)) {
      if (formatById[id]) continue;
      loadFormat(id).then((r) => {
        if (r.ok) setFormatById((m) => ({ ...m, [id]: r.data }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, formatIds]);

  const t = now();
  const errors = validateDraft(draft, t);
  const invalid = hasErrors(errors);
  const show = (msg?: string) => (touched ? msg : undefined);
  const whenOk = !errors.days && !errors.time && !errors.tz && !errors.onceAt;
  const when = whenOk ? draftWhen(draft) : null;
  const runAt = when ? nextFireAt(when, t) : null;
  const quotaFire = when ? quotaHourFire(when, t) : null;

  const set = (patch: Partial<ScheduleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleDay = (day: number) =>
    set({ days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day].sort() });

  const formatList = formats.length ? formats : [{ id: DEFAULT_SHORT_FORMAT_ID, name: "Default" }];

  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    const input = draftToInput(draft);
    const res = schedule ? await save(schedule.id, input) : await create(input);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved(res.data);
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{schedule ? `Edit “${schedule.name}”` : "New schedule"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <TextField
              size="small"
              label="Name"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              error={!!show(errors.name)}
              helperText={show(errors.name)}
              disabled={busy}
              sx={{ minWidth: 260, flex: 1 }}
            />
            <FormControlLabel
              control={<Switch checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} disabled={busy} />}
              label="On"
            />
          </Stack>

          <Stack spacing={1}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={draft.repeat}
              onChange={(_e, v) => v && set({ repeat: v })}
              aria-label="Repeat"
              disabled={busy}
            >
              <ToggleButton value="weekly">Weekly</ToggleButton>
              <ToggleButton value="once">Once</ToggleButton>
            </ToggleButtonGroup>
            {draft.repeat === "weekly" ? (
              <>
                <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }} role="group" aria-label="Days">
                  {WEEK.map((w) => (
                    <Chip
                      key={w.day}
                      label={w.short}
                      color={draft.days.includes(w.day) ? "primary" : "default"}
                      variant={draft.days.includes(w.day) ? "filled" : "outlined"}
                      onClick={() => toggleDay(w.day)}
                      aria-pressed={draft.days.includes(w.day)}
                      disabled={busy}
                    />
                  ))}
                </Stack>
                {errors.days && (
                  <Typography variant="caption" color="error">
                    {errors.days}
                  </Typography>
                )}
                <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                  <TextField
                    size="small"
                    type="time"
                    label="Time"
                    value={draft.time}
                    onChange={(e) => set({ time: e.target.value })}
                    error={!!errors.time}
                    helperText={errors.time}
                    disabled={busy}
                    slotProps={{ inputLabel: { shrink: true } }}
                    sx={{ width: 140 }}
                  />
                  <Autocomplete
                    freeSolo
                    size="small"
                    options={zones}
                    value={draft.tz}
                    onInputChange={(_e, v) => set({ tz: v })}
                    disabled={busy}
                    sx={{ minWidth: 260 }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Time zone"
                        error={!!errors.tz}
                        helperText={errors.tz ?? "The time is wall-clock time here, summer time included."}
                      />
                    )}
                  />
                </Stack>
              </>
            ) : (
              <TextField
                size="small"
                type="datetime-local"
                label="At"
                value={draft.onceAt}
                onChange={(e) => set({ onceAt: e.target.value })}
                error={!!errors.onceAt}
                helperText={errors.onceAt ?? "Your browser's local time."}
                disabled={busy}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ width: 260 }}
              />
            )}
            {when && (
              <Typography variant="caption" color="text.secondary" data-testid="editor-next-run">
                Next run: {describeNextRun(runAt, when)}
              </Typography>
            )}
            {quotaFire != null && (
              <Alert severity="warning" data-testid="quota-warning">
                This runs at {fmtInZone(quotaFire, LONDON)} London, in the last hour of the YouTube quota day (it resets at
                midnight Pacific, {quotaResetLondon(quotaFire)} London). The live channels have spent most of the day&apos;s
                quota by then and the videos would share their reserve. Consider {quotaResetLondon(quotaFire).replace(/:00$/, ":15")} London or
                later.
              </Alert>
            )}
          </Stack>

          <EncoderSelect
            purpose="video"
            label="Encoder"
            encoders={encoders}
            value={draft.encoderId}
            onChange={(id) => set({ encoderId: id })}
            disabled={busy}
          />

          <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <FormControlLabel
              control={<Switch checked={draft.offline} onChange={(e) => set({ offline: e.target.checked })} disabled={busy} />}
              label="Offline test"
            />
            {!draft.offline && (
              <TextField
                select
                size="small"
                label="YouTube channel"
                value={draft.accountId}
                onChange={(e) => set({ accountId: e.target.value })}
                disabled={busy}
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                sx={{ minWidth: 220 }}
              >
                <MenuItem value="">Each format&apos;s default</MenuItem>
                {accounts.map((a) => (
                  <MenuItem key={a.channelId} value={a.channelId}>
                    {a.channelTitle || a.channelId}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              size="small"
              type="number"
              label="Start within (minutes)"
              value={Number.isFinite(draft.startByMs) ? Math.round(draft.startByMs / 60_000) : ""}
              onChange={(e) => set({ startByMs: e.target.value === "" ? NaN : Number(e.target.value) * 60_000 })}
              error={!!errors.startBy}
              helperText={errors.startBy ?? "A video not started by then is skipped as too late."}
              disabled={busy}
              slotProps={{ htmlInput: { min: 1, max: 1440 } }}
              sx={{ width: 220 }}
            />
          </Stack>
          {draft.offline && (
            <Typography variant="caption" color="text.secondary">
              Every video rehearses on the encoder with YouTube switched off.
            </Typography>
          )}

          <Typography variant="overline" color="text.secondary">
            Videos, in order
          </Typography>
          {draft.videos.map((v, i) => (
            <ScheduleVideoCard
              key={v.key}
              video={v}
              index={i}
              count={draft.videos.length}
              formats={formatList}
              scripts={scripts}
              format={formatById[v.formatId] ?? null}
              settings={settings}
              runAt={runAt}
              now={t}
              error={show(errors.video[i])}
              disabled={busy}
              onChange={(next) => set({ videos: draft.videos.map((x, j) => (j === i ? next : x)) })}
              onMove={(delta) => set({ videos: moveItem(draft.videos, i, delta) })}
              onRemove={() => set({ videos: draft.videos.filter((_x, j) => j !== i) })}
            />
          ))}
          {show(errors.videos) && <Alert severity="error">{errors.videos}</Alert>}
          <Button
            variant="outlined"
            onClick={() => set({ videos: [...draft.videos, newDraftVideo(formatList[0]?.id ?? DEFAULT_SHORT_FORMAT_ID)] })}
            disabled={busy}
            sx={{ alignSelf: "flex-start" }}
          >
            Add a video
          </Button>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={busy || (touched && invalid)}>
          {busy ? "Saving…" : schedule ? "Save" : "Create schedule"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
