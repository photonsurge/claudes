"use client";

/**
 * The Render form (docs/short-video-plan.md §6.1): queue one video on an
 * encoder. Opened from a script's Render button (a saved script) and from the
 * generate form (generate at the front of the queue, §6.6). It starts from the
 * format's render defaults and YouTube video card:
 *
 *  - Encoder: video encoders first, the format's default (or the first free
 *    video encoder) preselected, then "Any video encoder", then channel
 *    encoders (a free one can be picked, with a warning). Each shows what it is
 *    doing (§6.2) — a busy one queues the video behind it.
 *  - YouTube channel: the connected-account select the streams form uses.
 *  - Publish as: from the format; applied when the run ends (§6.3).
 *  - Title: the format's template, shown resolved with the script's values. It
 *    can be changed for this one video (it goes in `ShortRender.video.title`,
 *    still a template — the worker resolves it at the front of the queue).
 *  - Mode: Offline test (no YouTube, §7) or Live.
 *  - When: Now, or At a date and time (`notBefore`; it is skipped as too late
 *    an hour after that, like a scheduled video's start-by window).
 *
 * No chat toggle: a render never polls chat (§6.3).
 */
import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { YoutubePrivacy } from "@photonsurge/shared/runs";
import type { ShortFormat } from "@photonsurge/shared/short-format";
import type { ShortRender, ShortRenderRequest } from "@photonsurge/shared/short-render";
import {
  scriptDurationMs,
  shortPlaceName,
  type ShortInclude,
  type ShortScope,
  type ShortScript,
} from "@photonsurge/shared/short-script";
import EncoderSelect from "../streams/EncoderSelect";
import {
  exampleVideoValues,
  fetchRenderOptions,
  getShortFormat,
  previewVideoTitle,
  textLength,
} from "../../../lib/short-formats";
import { defaultRenderEncoder, queueRender, type EncoderWithOccupancy } from "../../../lib/renders";
import { formatDuration, getShort, scopeLabel } from "../../../lib/shorts";
import type { StreamAccount } from "../../../lib/stream";

/** What the dialog renders: a saved script, or a generate request (made at the front of the queue). */
export type RenderTarget =
  | { type: "script"; scriptId: string }
  | { type: "generate"; formatId: string; scope: ShortScope; include?: ShortInclude };

/** How long after its "At" time a video may still start (§6.9 start-by window, 1 h). */
export const AT_START_BY_MS = 60 * 60_000;

interface Props {
  open: boolean;
  target: RenderTarget | null;
  onClose: () => void;
  /** Called with the stored render once the worker has queued it. */
  onQueued?: (render: ShortRender) => void;
  /** Injectable for tests. */
  loadOptions?: () => Promise<{ encoders: EncoderWithOccupancy[]; accounts: StreamAccount[] }>;
  loadFormat?: typeof getShortFormat;
  loadScript?: typeof getShort;
  queue?: typeof queueRender;
  now?: () => number;
}

/** "2026-10-04T18:00" in local time, for a datetime-local input. */
function localInputValue(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function RenderDialog({
  open,
  target,
  onClose,
  onQueued,
  loadOptions = fetchRenderOptions,
  loadFormat = getShortFormat,
  loadScript = getShort,
  queue = queueRender,
  now = Date.now,
}: Props) {
  const [encoders, setEncoders] = useState<EncoderWithOccupancy[]>([]);
  const [accounts, setAccounts] = useState<StreamAccount[]>([]);
  const [format, setFormat] = useState<ShortFormat | null>(null);
  const [script, setScript] = useState<ShortScript | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [encoderId, setEncoderId] = useState("any");
  const [accountId, setAccountId] = useState("");
  const [publishAs, setPublishAs] = useState<YoutubePrivacy>("unlisted");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"live" | "offline">("live");
  const [when, setWhen] = useState<"now" | "at">("now");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load everything the form starts from each time it opens.
  const targetKey = JSON.stringify(target);
  useEffect(() => {
    if (!open || !target) return;
    let live = true;
    setLoading(true);
    setLoadError(null);
    setError(null);
    setScript(null);
    setFormat(null);
    (async () => {
      let s: ShortScript | null = null;
      if (target.type === "script") {
        const res = await loadScript(target.scriptId);
        if (!res.ok) throw new Error(res.error);
        s = res.data;
      }
      const formatId = target.type === "script" ? s!.formatId : target.formatId;
      const [fmt, opts] = await Promise.all([loadFormat(formatId), loadOptions()]);
      if (!fmt.ok) throw new Error(fmt.error);
      if (!live) return;
      setScript(s);
      setFormat(fmt.data);
      setEncoders(opts.encoders);
      setAccounts(opts.accounts);
      setEncoderId(defaultRenderEncoder(opts.encoders, fmt.data.render.encoderId));
      const acct = fmt.data.render.accountId;
      setAccountId(acct && opts.accounts.some((a) => a.channelId === acct) ? acct : "");
      setPublishAs(fmt.data.video.publishAs);
      setTitle(fmt.data.video.title);
      setMode("live");
      setWhen("now");
      setAt(localInputValue(now() + 60 * 60_000));
    })()
      .catch((err) => live && setLoadError(String((err as Error)?.message ?? err)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // targetKey stands for target; the loaders are stable props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetKey]);

  const durationMs = script ? scriptDurationMs(script.clips) : 0;
  const values = useMemo(() => {
    if (script?.values) return { ...script.values, duration: formatDuration(durationMs) };
    // A generate request has no values until it generates: show examples, with what is known.
    const ex = exampleVideoValues();
    if (format) ex.format = format.name;
    if (target?.type === "generate") {
      const sc = target.scope;
      if (sc.type === "globe") ex.place = "World";
      else if (sc.type === "places") {
        // As script-values stamps them for several places (§6.8).
        ex.place = sc.places.map(shortPlaceName).join(", ");
        ex.placeId = "places";
        ex.places = String(sc.places.length);
        ex.flag = "";
      } else ex.place = scopeLabel(sc).replace(/^\w+ · /, "");
    }
    return ex;
  }, [script, format, target, durationMs]);
  const resolvedTitle = format
    ? previewVideoTitle(title || format.video.title, values, new Date(now()), format.video.timezone)
    : "";

  const atMs = when === "at" && at ? new Date(at).getTime() : NaN;
  const atInvalid = when === "at" && (!Number.isFinite(atMs) || atMs <= now());
  const offline = mode === "offline";
  const noAccount = !offline && accounts.length === 0;
  const empty = !!script && !script.clips.length;

  const submit = async () => {
    if (!target || !format) return;
    setBusy(true);
    setError(null);
    const req: ShortRenderRequest = {
      encoderId,
      what:
        target.type === "script"
          ? { type: "script", scriptId: target.scriptId }
          : {
              type: "generate",
              formatId: target.formatId,
              scope: target.scope,
              ...(target.include ? { include: target.include } : {}),
            },
      publishAs,
      offline,
    };
    if (!offline && accountId) req.accountId = accountId;
    if (title.trim() && title.trim() !== format.video.title) req.video = { title: title.trim() };
    if (when === "at") {
      req.notBefore = atMs;
      req.startBy = atMs + AT_START_BY_MS;
    }
    const res = await queue(req);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onQueued?.(res.data.render);
    onClose();
  };

  const heading = script
    ? `“${script.title}” · ${formatDuration(durationMs)}`
    : target?.type === "generate"
      ? target.scope.type === "places"
        ? `A new round-up of ${scopeLabel(target.scope)}, generated when it reaches the front`
        : `A new ${scopeLabel(target.scope).toLowerCase()} round-up, generated when it reaches the front`
      : "";

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Render a video</DialogTitle>
      <DialogContent>
        {loading && <Typography color="text.secondary">Loading…</Typography>}
        {loadError && <Alert severity="error">{loadError}</Alert>}
        {format && !loading && (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {heading} · format {format.name}
            </Typography>

            <EncoderSelect
              purpose="video"
              label="Encoder"
              encoders={encoders}
              value={encoderId}
              onChange={setEncoderId}
              disabled={busy}
            />

            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode}
              onChange={(_e, v) => v && setMode(v)}
              aria-label="Mode"
              disabled={busy}
            >
              <ToggleButton value="offline">Offline test</ToggleButton>
              <ToggleButton value="live">Live</ToggleButton>
            </ToggleButtonGroup>
            {offline && (
              <Typography variant="caption" color="text.secondary">
                A full rehearsal on the encoder with YouTube switched off: no broadcast, no stream key.
              </Typography>
            )}

            {!offline && (
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                <TextField
                  select
                  size="small"
                  label="YouTube channel"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={busy}
                  sx={{ minWidth: 220 }}
                >
                  <MenuItem value="">Default channel</MenuItem>
                  {accounts.map((a) => (
                    <MenuItem key={a.channelId} value={a.channelId}>
                      {a.channelTitle || a.channelId}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Publish as"
                  value={publishAs}
                  onChange={(e) => setPublishAs(e.target.value as YoutubePrivacy)}
                  disabled={busy}
                  helperText="Streams unlisted; this is applied when it ends."
                  sx={{ minWidth: 160 }}
                >
                  <MenuItem value="public">Public</MenuItem>
                  <MenuItem value="unlisted">Unlisted</MenuItem>
                  <MenuItem value="private">Private</MenuItem>
                </TextField>
              </Stack>
            )}
            {noAccount && (
              <Alert severity="warning">
                No YouTube channel is connected — connect one on /admin/streams, or run an offline test.
              </Alert>
            )}

            {!offline && (
              <Stack spacing={0.5}>
                <TextField
                  size="small"
                  label="Title (this video only)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                  helperText="The format's title template; change it here for this one video. Codes like %{place} and %A still resolve."
                />
                <Typography variant="body2" aria-label="Resolved title">
                  {resolvedTitle}{" "}
                  <Typography component="span" variant="caption" color="text.secondary">
                    ({textLength(resolvedTitle)}/100{script?.values ? "" : ", example values until it generates"})
                  </Typography>
                </Typography>
              </Stack>
            )}

            <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={when}
                onChange={(_e, v) => v && setWhen(v)}
                aria-label="When"
                disabled={busy}
              >
                <ToggleButton value="now">Now</ToggleButton>
                <ToggleButton value="at">At</ToggleButton>
              </ToggleButtonGroup>
              {when === "at" && (
                <TextField
                  size="small"
                  type="datetime-local"
                  label="Start at"
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                  error={atInvalid}
                  helperText={
                    atInvalid ? "Pick a time in the future." : "Skipped as too late if it hasn't started an hour after."
                  }
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Either way the video joins the encoder&apos;s queue — it doesn&apos;t need the encoder to be free.
            </Typography>

            {empty && <Alert severity="error">This script has no clips — generate it again.</Alert>}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || !format || loading || atInvalid || noAccount || empty}
        >
          {busy ? "Queuing…" : when === "at" ? "Queue for later" : offline ? "Queue offline test" : "Queue render"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
