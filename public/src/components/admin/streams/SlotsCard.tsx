"use client";

/**
 * Persistent ("constant") streams card for /admin/streams. Each slot is a
 * standing order: while enabled, the worker reconciler keeps an unbounded run
 * live on that scene/encoder, restarting it with backoff if it dies. The enable
 * switch is the on/off control for the whole constant stream.
 */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import MuiLink from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { SceneMeta } from "@photonsurge/shared/control";
import { runIsActive, type RunState, type StreamEncoderInfo, type StreamSlot } from "@photonsurge/shared/runs";

/** Connected YouTube channel a slot can publish to (subset of lib/stream StreamAccount). */
export interface SlotAccount {
  channelId: string;
  channelTitle?: string;
}

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
  onSave: (body: Partial<StreamSlot> & { sceneId: string }) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  };

  return (
    <Paper sx={{ p: 1.75, mt: 1.75 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        Constant streams
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Always-on YouTube streams the worker keeps alive (restarted with backoff if they die). Switch a
        slot on to go live; switching it off ends its stream.
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
            run={runs.find((r) => r.id === slot.runId) ?? null}
            onToggle={(enabled) => run(() => onSave({ ...slot, enabled }))}
            onDelete={() => run(() => onDelete(slot.id))}
          />
        ))}
      </Box>

      <AddSlotForm
        scenes={scenes}
        encoders={encoders}
        accounts={accounts}
        onSave={(body) => run(() => onSave(body))}
      />
      {err && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {err}
        </Alert>
      )}
    </Paper>
  );
}

function SlotRow({
  slot,
  accounts,
  run,
  onToggle,
  onDelete,
}: {
  slot: StreamSlot;
  accounts: SlotAccount[];
  run: RunState | null;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
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
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
      <Chip size="small" color={slotStatusColor(status)} label={status} />
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {slot.name || slot.id}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        channel {slot.sceneId} · encoder {slot.encoderId || "auto"} · {slot.privacy || "public"}
        {channel ? ` · YT ${channel}` : " · default YT"}
        {slot.monitorStream ? " · monitor" : ""}
        {slot.chat?.enabled ? (slot.chat.promoteToTicker ? " · chat→ticker" : " · chat") : ""}
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
      <Box sx={{ flex: 1 }} />
      <Switch
        size="small"
        checked={slot.enabled}
        onChange={(e) => onToggle(e.target.checked)}
        slotProps={{ input: { "aria-label": `enable ${slot.name || slot.id}` } }}
      />
      <Button size="small" color="error" onClick={onDelete}>
        Remove
      </Button>
    </Stack>
  );
}

function AddSlotForm({
  scenes,
  encoders,
  accounts,
  onSave,
}: {
  scenes: SceneMeta[];
  encoders: StreamEncoderInfo[];
  accounts: SlotAccount[];
  onSave: (body: Partial<StreamSlot> & { sceneId: string }) => void;
}) {
  const [name, setName] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [encoderId, setEncoderId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [title, setTitle] = useState("");
  const [privacy, setPrivacy] = useState<"public" | "unlisted" | "private">("public");
  const [monitorStream, setMonitorStream] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [promoteToTicker, setPromoteToTicker] = useState(false);

  const add = () => {
    onSave({
      name: name || undefined,
      sceneId,
      encoderId: encoderId || undefined,
      accountId: accountId || undefined,
      title: title || undefined,
      privacy,
      monitorStream,
      chat: { enabled: chatEnabled, promoteToTicker: chatEnabled && promoteToTicker },
      enabled: false, // created off — the switch is the go-live control
    });
    setName("");
    setSceneId("");
    setEncoderId("");
    setAccountId("");
    setTitle("");
    setMonitorStream(false);
    setChatEnabled(false);
    setPromoteToTicker(false);
  };

  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center", mt: 1.5 }}>
      <TextField label="name" value={name} onChange={(e) => setName(e.target.value)} sx={{ width: 140 }} />
      <TextField select label="channel" value={sceneId} onChange={(e) => setSceneId(e.target.value)} sx={{ minWidth: 140 }}>
        {scenes.map((s) => (
          <MenuItem key={s.id} value={s.id}>
            {s.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="encoder"
        value={encoderId}
        onChange={(e) => setEncoderId(e.target.value)}
        sx={{ minWidth: 130 }}
      >
        <MenuItem value="">auto</MenuItem>
        {encoders.map((enc) => (
          <MenuItem key={enc.id} value={enc.id}>
            {enc.name || enc.id}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="YouTube"
        value={accounts.some((a) => a.channelId === accountId) ? accountId : ""}
        onChange={(e) => setAccountId(e.target.value)}
        sx={{ minWidth: 150 }}
      >
        <MenuItem value="">Default channel</MenuItem>
        {accounts.map((a) => (
          <MenuItem key={a.channelId} value={a.channelId}>
            {a.channelTitle || a.channelId}
          </MenuItem>
        ))}
      </TextField>
      <TextField label="title" value={title} onChange={(e) => setTitle(e.target.value)} sx={{ flex: 1, minWidth: 160 }} />
      <TextField
        select
        label="privacy"
        value={privacy}
        onChange={(e) => setPrivacy(e.target.value as typeof privacy)}
        sx={{ minWidth: 110 }}
      >
        <MenuItem value="public">Public</MenuItem>
        <MenuItem value="unlisted">Unlisted</MenuItem>
        <MenuItem value="private">Private</MenuItem>
      </TextField>
      <FormControlLabel
        control={<Checkbox checked={monitorStream} onChange={(e) => setMonitorStream(e.target.checked)} />}
        label="monitor"
      />
      <FormControlLabel
        control={<Checkbox checked={chatEnabled} onChange={(e) => setChatEnabled(e.target.checked)} />}
        label="chat"
      />
      {chatEnabled && (
        <FormControlLabel
          control={<Checkbox checked={promoteToTicker} onChange={(e) => setPromoteToTicker(e.target.checked)} />}
          label="→ ticker"
        />
      )}
      <Button variant="outlined" onClick={add} disabled={!sceneId}>
        Add stream
      </Button>
    </Stack>
  );
}
