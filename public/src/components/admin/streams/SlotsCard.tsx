"use client";

/**
 * Persistent ("constant") streams card for /admin/streams. Each slot is a
 * standing order: while enabled, the worker reconciler keeps an unbounded run
 * live on that scene/encoder, restarting it with backoff if it dies. The enable
 * switch is the on/off control for the whole constant stream; every other
 * setting lives in one edit dialog (SlotDialog) shared by "add" and "edit".
 */
import { useState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MuiLink from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { SceneMeta } from "@photonsurge/shared/control";
import {
  DEFAULT_CHAT_POLL_MS,
  fmtChatPoll,
  runIsActive,
  type RunState,
  type StreamEncoderInfo,
  type StreamSlot,
  type YoutubePrivacy,
} from "@photonsurge/shared/runs";
import { vodArchiveAtRisk } from "@photonsurge/shared/vod";
import EncoderSelect from "./EncoderSelect";
import StreamTitleField from "../../StreamTitleField";
import ChatPollSelect from "./ChatPollSelect";

/** Connected YouTube channel a slot can publish to (subset of lib/stream StreamAccount). */
export interface SlotAccount {
  channelId: string;
  channelTitle?: string;
}

/** Selectable scheduled-restart cadences (minutes; 0 = never recycle). */
const RESTART_MINUTES = [0, 10, 15, 30, 45, 60, 120, 240, 360, 480, 660, 720, 1440];
const MINUTE_MS = 60_000;
const restartLabel = (m: number) => (m === 0 ? "never" : m < 60 ? `${m} min` : `${m / 60}h`);

/** Colour for a slot's derived status label (canonical run statuses + off/starting/retrying/…). */
function slotStatusColor(status: string): "default" | "error" | "warning" | "success" {
  if (status === "live" || status === "failed") return "error";
  if (status === "off") return "default";
  return "warning"; // scheduled / awaiting-ingest / ending / starting… / stopping… / retrying (n)
}

/** Resolve a channelId to its display title (falls back to the id). */
function accountLabel(accounts: SlotAccount[], accountId?: string): string | null {
  if (!accountId) return null;
  const a = accounts.find((x) => x.channelId === accountId);
  return a?.channelTitle || accountId;
}


type SaveBody = Partial<StreamSlot> & { sceneId: string };

export default function SlotsCard({
  slots,
  scenes,
  encoders,
  accounts = [],
  runs,
  onSave,
  onDelete,
}: {
  slots: StreamSlot[];
  scenes: SceneMeta[];
  encoders: StreamEncoderInfo[];
  accounts?: SlotAccount[];
  runs: RunState[];
  onSave: (body: SaveBody) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const [err, setErr] = useState<string | null>(null);
  // null = closed; { slot: undefined } = adding a new stream.
  const [editing, setEditing] = useState<{ slot?: StreamSlot } | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  };
  const runFor = (slot?: StreamSlot) => (slot ? (runs.find((r) => r.id === slot.runId) ?? null) : null);

  return (
    <Paper sx={{ p: 1.75, mt: 1.75 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
          Constant streams
        </Typography>
        <Button size="small" variant="outlined" onClick={() => setEditing({})}>
          Add stream
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Always-on YouTube streams the worker keeps alive (restarted with backoff if they die). Switch a
        slot on to go live; switching it off ends its stream. A restart interval recycles the stream on
        that cadence — the run is ended and relaunched onto a fresh broadcast. YouTube does not archive
        streams that run 12 h or longer: a slot set to never, 12h or 24h leaves no VOD, so its as-run
        pages and chapters have no video to point at — keep the interval under 12 h for that.
      </Typography>

      <Box sx={{ display: "grid", gap: 1, mt: 1.25 }}>
        {slots.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No constant streams configured.
          </Typography>
        )}
        {slots.map((slot) => (
          <SlotRow
            key={slot.id}
            slot={slot}
            accounts={accounts}
            encoders={encoders}
            scenes={scenes}
            run={runFor(slot)}
            onToggle={(enabled) => run(() => onSave({ ...slot, enabled }))}
            onEdit={() => setEditing({ slot })}
          />
        ))}
      </Box>

      {err && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {err}
        </Alert>
      )}

      {editing && (
        <SlotDialog
          // Remount per slot so the draft always starts from the saved values.
          key={editing.slot?.id ?? "new"}
          slot={editing.slot}
          run={runFor(editing.slot)}
          scenes={scenes}
          encoders={encoders}
          accounts={accounts}
          onSave={onSave}
          onDelete={onDelete}
          onClose={() => setEditing(null)}
        />
      )}
    </Paper>
  );
}

function SlotRow({
  slot,
  accounts,
  encoders,
  scenes,
  run,
  onToggle,
  onEdit,
}: {
  slot: StreamSlot;
  accounts: SlotAccount[];
  encoders: StreamEncoderInfo[];
  scenes: SceneMeta[];
  run: RunState | null;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
}) {
  const active = !!run && runIsActive(run.status);
  const status = !slot.enabled
    ? active
      ? "stopping…"
      : "off"
    : active
      ? run!.status
      : (slot.failCount ?? 0) > 1
        ? `retrying (${slot.failCount})`
        : "starting…";
  const channel = accountLabel(accounts, slot.accountId);
  const sceneName = scenes.find((s) => s.id === slot.sceneId)?.name || slot.sceneId;
  const encoder = slot.encoderId ? encoders.find((e) => e.id === slot.encoderId)?.name || slot.encoderId : "auto";
  const restartMin = Math.round((slot.restartEveryMs ?? 0) / MINUTE_MS);
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
      <Chip size="small" color={slotStatusColor(status)} label={status} />
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {slot.name || slot.id}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        channel {sceneName} · encoder {encoder} · {slot.privacy || "public"}
        {channel ? ` · YT ${channel}` : " · default YT"}
        {` · restart ${restartLabel(restartMin)}`}
        {slot.monitorStream ? " · monitor" : ""}
        {slot.chat?.enabled !== false
          ? ` · chat${slot.chat?.promoteToTicker ? "→ticker" : ""} ${fmtChatPoll(slot.chat?.pollEveryMs)}`
          : " · no chat"}
        {slot.announce ? " · 📣" : ""}
      </Typography>
      {run?.youtube?.watchUrl && (
        <MuiLink href={run.youtube.watchUrl} target="_blank" variant="caption">
          Watch ↗
        </MuiLink>
      )}
      {run?.error && (
        <Typography variant="caption" color="error">
          {run.error.step}: {run.error.message}
        </Typography>
      )}
      {vodArchiveAtRisk(slot.restartEveryMs) && (
        <Chip
          size="small"
          variant="outlined"
          color="warning"
          label="no VOD"
          title="YouTube won't archive a stream that runs 12 h or longer — set the restart interval under 12 h if you want the as-run page and chapters to have a video"
        />
      )}
      <Box sx={{ flex: 1 }} />
      <Button size="small" onClick={onEdit} aria-label={`edit ${slot.name || slot.id}`}>
        Edit
      </Button>
      <Switch
        size="small"
        checked={slot.enabled}
        onChange={(e) => onToggle(e.target.checked)}
        slotProps={{ input: { "aria-label": `enable ${slot.name || slot.id}` } }}
      />
    </Stack>
  );
}

interface Draft {
  name: string;
  sceneId: string;
  encoderId: string;
  accountId: string;
  title: string;
  privacy: YoutubePrivacy;
  restartMinutes: number;
  monitorStream: boolean;
  chatEnabled: boolean;
  promoteToTicker: boolean;
  pollEveryMs: number | null;
  announce: boolean;
}

function draftFrom(slot?: StreamSlot): Draft {
  return {
    name: slot?.name ?? "",
    sceneId: slot?.sceneId ?? "",
    encoderId: slot?.encoderId ?? "",
    accountId: slot?.accountId ?? "",
    title: slot?.title ?? "",
    privacy: slot?.privacy ?? "public",
    restartMinutes: Math.round((slot?.restartEveryMs ?? 0) / MINUTE_MS),
    monitorStream: !!slot?.monitorStream,
    // Chat defaults ON — the chat log only records while a run's poller runs.
    chatEnabled: slot ? slot.chat?.enabled !== false : true,
    promoteToTicker: !!slot?.chat?.promoteToTicker,
    // New streams start calm (every 2 min); existing ones keep what they have.
    pollEveryMs: slot ? (slot.chat?.pollEveryMs ?? null) : DEFAULT_CHAT_POLL_MS,
    announce: !!slot?.announce,
  };
}

function SlotDialog({
  slot,
  run,
  scenes,
  encoders,
  accounts,
  onSave,
  onDelete,
  onClose,
}: {
  slot?: StreamSlot;
  run: RunState | null;
  scenes: SceneMeta[];
  encoders: StreamEncoderInfo[];
  accounts: SlotAccount[];
  onSave: (body: SaveBody) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(slot));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const live = !!run && runIsActive(run.status);
  const restartMs = d.restartMinutes ? d.restartMinutes * MINUTE_MS : null;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose(); // unmounts the dialog — no state to reset
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  };

  const save = () =>
    act(() =>
      onSave({
        ...(slot ?? {}),
        name: d.name.trim() || undefined,
        sceneId: d.sceneId,
        encoderId: d.encoderId || undefined,
        accountId: d.accountId || undefined,
        title: d.title,
        privacy: d.privacy,
        restartEveryMs: restartMs,
        monitorStream: d.monitorStream,
        chat: {
          enabled: d.chatEnabled,
          promoteToTicker: d.chatEnabled && d.promoteToTicker,
          pollEveryMs: d.pollEveryMs,
        },
        announce: d.announce,
        enabled: slot ? slot.enabled : false, // created off — the switch is the go-live control
      }),
    );

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{slot ? `Edit ${slot.name || slot.id}` : "Add constant stream"}</DialogTitle>
      <DialogContent dividers>
        {live && (
          <Alert severity="info" sx={{ mb: 2 }}>
            This stream is live. The chat poll interval applies within about 30 s; everything else (channel,
            encoder, YouTube channel, title, privacy, chat on/off, monitor) applies at its next launch or scheduled
            restart.
          </Alert>
        )}

        <Section title="Stream">
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
            <TextField label="name" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Wind 24/7" />
            <TextField select label="channel" value={d.sceneId} onChange={(e) => set("sceneId", e.target.value)}>
              {scenes.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
            <EncoderSelect purpose="channel" encoders={encoders} value={d.encoderId} onChange={(v) => set("encoderId", v)} />
            <TextField
              select
              label="YouTube"
              value={accounts.some((a) => a.channelId === d.accountId) ? d.accountId : ""}
              onChange={(e) => set("accountId", e.target.value)}
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
              label="privacy"
              value={d.privacy}
              onChange={(e) => set("privacy", e.target.value as YoutubePrivacy)}
            >
              <MenuItem value="public">Public</MenuItem>
              <MenuItem value="unlisted">Unlisted</MenuItem>
              <MenuItem value="private">Private</MenuItem>
            </TextField>
            <TextField
              select
              label="restart"
              value={String(d.restartMinutes)}
              onChange={(e) => set("restartMinutes", Number(e.target.value) || 0)}
              helperText={
                vodArchiveAtRisk(restartMs)
                  ? "No VOD: YouTube won't archive a stream that runs 12 h or longer."
                  : "Ends and relaunches onto a fresh broadcast on this cadence."
              }
            >
              {RESTART_MINUTES.map((m) => (
                <MenuItem key={m} value={String(m)}>
                  {restartLabel(m)}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </Section>

        <Section title="Title">
          <StreamTitleField value={d.title} onChange={(v) => set("title", v)} recurring />
          {d.sceneId && (
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
              The description and thumbnail come from the channel&apos;s{" "}
              <MuiLink href={`/admin/scenes/${encodeURIComponent(d.sceneId)}#youtube`}>YouTube settings</MuiLink>.
            </Typography>
          )}
        </Section>

        <Section title="Chat">
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", alignItems: "flex-start" }}>
            <FormControlLabel
              control={<Checkbox checked={d.chatEnabled} onChange={(e) => set("chatEnabled", e.target.checked)} />}
              label="monitor chat"
            />
            <FormControlLabel
              disabled={!d.chatEnabled}
              control={<Checkbox checked={d.promoteToTicker} onChange={(e) => set("promoteToTicker", e.target.checked)} />}
              label="→ ticker"
            />
            <Box sx={{ flex: 1, minWidth: 240 }}>
              <ChatPollSelect value={d.pollEveryMs} onChange={(v) => set("pollEveryMs", v)} disabled={!d.chatEnabled} fullWidth />
            </Box>
          </Stack>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            Every chat check costs YouTube quota whether or not anyone spoke (10k units/day shared by every stream,
            go-live and end included). Commands that pile up between checks are merged: each viewer counts once and
            each command goes to a vote, so the most-asked-for option wins (a mod&apos;s request always wins).
          </Typography>
        </Section>

        <Section title="Extras">
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
            <FormControlLabel
              control={<Checkbox checked={d.monitorStream} onChange={(e) => set("monitorStream", e.target.checked)} />}
              label="monitor stream (YouTube preview)"
            />
            <FormControlLabel
              control={<Checkbox checked={d.announce} onChange={(e) => set("announce", e.target.checked)} />}
              label="📣 notify"
              title="Notify the world each time this stream (re)launches: hydra blog post + social fan-out with the watch URL"
            />
          </Stack>
        </Section>

        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        {slot &&
          (confirmRemove ? (
            <>
              <Typography variant="caption" color="error" sx={{ mr: 1 }}>
                {live ? "This ends the live stream too." : "Remove this stream?"}
              </Typography>
              <Button color="error" variant="contained" disabled={busy} onClick={() => act(() => onDelete(slot.id))}>
                Confirm remove
              </Button>
              <Button disabled={busy} onClick={() => setConfirmRemove(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button color="error" disabled={busy} onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          ))}
        <Box sx={{ flex: 1 }} />
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" disabled={busy || !d.sceneId} onClick={save}>
          {slot ? "Save" : "Add stream"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography variant="overline" color="text.secondary" component="h3" sx={{ display: "block", mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
