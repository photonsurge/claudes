"use client";

/**
 * The Schedules section on /admin/shorts (docs/short-video-plan.md §8, §6.7).
 * One row per schedule: its name, when it fires in words ("Every day 08:15
 * Europe/London"), its next run in its own zone and London, the last outcome
 * (queued or missed, with a link that shows that batch in the Renders
 * section), the enable switch, Run batch now, Edit and Delete.
 *
 * Run batch now asks first, and offers a "publish as" override for the whole
 * batch (§8.1 step 5: the first trial goes out unlisted); by default each
 * video publishes as its format (or its own override) says.
 *
 * New opens the editor blank; Morning batch opens it pre-filled (§8.1).
 */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { YoutubePrivacy } from "@photonsurge/shared/runs";
import type { ShortSchedule } from "@photonsurge/shared/short-schedule";
import ScheduleEditor, { type ScheduleEditorProps } from "./ScheduleEditor";
import {
  deleteSchedule,
  describeNextRun,
  describeWhen,
  fmtInZone,
  LONDON,
  morningBatchDraft,
  runScheduleNow,
  setScheduleEnabled,
  useSchedules,
  type RunBatchResult,
  type ScheduleDraft,
} from "../../../lib/short-schedules";

type EditorDeps = Pick<
  ScheduleEditorProps,
  "formats" | "scripts" | "loadOptions" | "loadSettings" | "loadFormat" | "create" | "save" | "now"
>;

interface Props extends EditorDeps {
  /** Show one batch's renders in the Renders section. */
  onShowBatch?: (batchId: string) => void;
  /** Run batch now queued a batch. */
  onQueued?: (result: RunBatchResult) => void;
  /** Injectable for tests. */
  load?: Parameters<typeof useSchedules>[0];
  remove?: typeof deleteSchedule;
  setEnabled?: typeof setScheduleEnabled;
  runNow?: typeof runScheduleNow;
}

/** The Run batch now override: "format" = as each video's format says. */
type PublishOverride = "format" | YoutubePrivacy;

export default function SchedulesSection({
  onShowBatch,
  onQueued,
  load,
  remove = deleteSchedule,
  setEnabled = setScheduleEnabled,
  runNow = runScheduleNow,
  ...editorDeps
}: Props) {
  const now = editorDeps.now ?? Date.now;
  const { schedules, error, refresh } = useSchedules(load);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ schedule: ShortSchedule | null; preset?: ScheduleDraft } | null>(null);
  const [running, setRunning] = useState<ShortSchedule | null>(null);
  const [publishAs, setPublishAs] = useState<PublishOverride>("format");
  const [deleting, setDeleting] = useState<ShortSchedule | null>(null);

  const act = async (key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(key);
    setActionError(null);
    setNotice(null);
    const res = await fn();
    if (!res.ok) setActionError(res.error);
    await refresh();
    setBusy(null);
    return res.ok;
  };

  const confirmRun = async () => {
    const s = running;
    if (!s) return;
    let result: RunBatchResult | null = null;
    const ok = await act(`run:${s.id}`, async () => {
      const res = await runNow(s.id, publishAs === "format" ? undefined : publishAs);
      if (res.ok) result = res.data;
      return res.ok ? { ok: true } : res;
    });
    setRunning(null);
    if (ok && result) {
      const r: RunBatchResult = result;
      setNotice(`Queued ${r.n} video${r.n === 1 ? "" : "s"} from “${s.name}”${publishAs === "format" ? "" : `, all ${publishAs}`}.`);
      onQueued?.(r);
    }
  };

  const confirmDelete = async () => {
    const s = deleting;
    if (!s) return;
    await act(`del:${s.id}`, () => remove(s.id).then((r) => (r.ok ? { ok: true as const } : r)));
    setDeleting(null);
  };

  const list = schedules ?? [];

  return (
    <Paper sx={{ p: 1.75 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>
          Schedules
        </Typography>
        <Button size="small" variant="outlined" onClick={() => setEditing({ schedule: null, preset: morningBatchDraft(now()) })}>
          Morning batch
        </Button>
        <Button size="small" variant="contained" onClick={() => setEditing({ schedule: null })}>
          New schedule
        </Button>
      </Stack>
      {error && <Alert severity="error">Couldn&apos;t load schedules: {error}</Alert>}
      {actionError && (
        <Alert severity="error" onClose={() => setActionError(null)} sx={{ mt: 1 }}>
          {actionError}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)} sx={{ mt: 1 }}>
          {notice}
        </Alert>
      )}
      {schedules && !list.length && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          No schedules yet. A schedule queues its videos, in order, at its time — every day, on chosen days, or once.
          “Morning batch” starts one for Europe and the UK.
        </Typography>
      )}
      {!schedules && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Loading…
        </Typography>
      )}

      <Stack spacing={1} sx={{ mt: 1 }}>
        {list.map((s) => (
          <Paper key={s.id} variant="outlined" sx={{ p: 1.25 }} data-testid={`schedule-${s.id}`}>
            <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Switch
                checked={s.enabled}
                disabled={busy === `en:${s.id}`}
                onChange={(e) => act(`en:${s.id}`, () => setEnabled(s.id, e.target.checked).then((r) => (r.ok ? { ok: true as const } : r)))}
                slotProps={{ input: { "aria-label": `Enable ${s.name}` } }}
              />
              <Box sx={{ flex: 1, minWidth: 240 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {s.name}{" "}
                  <Typography component="span" variant="caption" color="text.secondary">
                    · {s.videos.length} video{s.videos.length === 1 ? "" : "s"}
                    {s.offline ? " · offline test" : ""}
                  </Typography>
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {describeWhen(s.when)} · next{" "}
                  <Box component="span" sx={{ color: "text.primary" }} data-testid="next-run">
                    {s.enabled ? describeNextRun(s.nextAt, s.when) : "off"}
                  </Box>
                </Typography>
                <LastFire s={s} onShowBatch={onShowBatch} />
              </Box>
              <Button
                size="small"
                variant="outlined"
                disabled={!s.videos.length || busy === `run:${s.id}`}
                onClick={() => {
                  setPublishAs("format");
                  setRunning(s);
                }}
              >
                Run batch now
              </Button>
              <Button size="small" onClick={() => setEditing({ schedule: s })}>
                Edit
              </Button>
              <Button size="small" color="error" onClick={() => setDeleting(s)}>
                Delete
              </Button>
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Dialog open={!!running} onClose={() => setRunning(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Run “{running?.name}” now?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography variant="body2">
              Queues its {running?.videos.length} video{running?.videos.length === 1 ? "" : "s"}, in order, on{" "}
              {running?.encoderId === "any" ? "any video encoder" : running?.encoderId}
              {running?.offline ? " as an offline test" : ""}. Its next scheduled time is unchanged.
            </Typography>
            {!running?.offline && (
              <TextField
                select
                size="small"
                label="Publish as"
                value={publishAs}
                onChange={(e) => setPublishAs(e.target.value as PublishOverride)}
                helperText="For this batch only — a first trial run is best unlisted."
              >
                <MenuItem value="format">As each format says</MenuItem>
                <MenuItem value="public">All public</MenuItem>
                <MenuItem value="unlisted">All unlisted</MenuItem>
                <MenuItem value="private">All private</MenuItem>
              </TextField>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRunning(null)}>Cancel</Button>
          <Button variant="contained" onClick={confirmRun} disabled={!!running && busy === `run:${running.id}`}>
            Queue batch
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleting} onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            It won&apos;t fire again. Videos it already queued stay in the Renders queue — cancel them there.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>Keep</Button>
          <Button color="error" variant="contained" onClick={confirmDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <ScheduleEditor
        {...editorDeps}
        open={!!editing}
        schedule={editing?.schedule ?? null}
        preset={editing?.preset}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />
    </Paper>
  );
}

function LastFire({ s, onShowBatch }: { s: ShortSchedule; onShowBatch?: (batchId: string) => void }) {
  const f = s.lastFire;
  if (!f) {
    return (
      <Typography variant="caption" color="text.secondary" component="div">
        Not run yet
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mt: 0.25 }} data-testid="last-fire">
      <Typography variant="caption" color="text.secondary">
        Last
      </Typography>
      <Chip size="small" color={f.outcome === "missed" ? "warning" : "success"} variant="outlined" label={f.outcome} />
      <Typography variant="caption" color="text.secondary">
        {fmtInZone(f.at, LONDON)} London{f.note ? ` · ${f.note}` : ""}
      </Typography>
      {f.batchId && onShowBatch && (
        <Button size="small" sx={{ py: 0, minWidth: 0 }} onClick={() => onShowBatch(f.batchId!)}>
          Show its renders
        </Button>
      )}
    </Stack>
  );
}
