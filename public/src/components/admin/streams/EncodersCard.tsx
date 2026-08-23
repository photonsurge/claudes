"use client";

/**
 * OBS encoder registry card for /admin/streams. One OBS instance = one
 * concurrent stream, so multi-view needs one row here per constant stream.
 * Each row records the obs-websocket endpoint and (optionally) which scene that
 * instance's browser source captures — run-creation auto-picks by scene. The
 * websocket password is write-only (stored encrypted server-side).
 */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { SceneMeta } from "@photonsurge/shared/control";
import type { StreamEncoderInfo } from "@photonsurge/shared/runs";
import type { ObsTestResult, ProvisionResult } from "../../../lib/stream";

export interface EncoderSave {
  id?: string;
  name?: string;
  url: string;
  password?: string;
  sceneId?: string;
  enabled?: boolean;
}

export default function EncodersCard({
  encoders,
  scenes,
  onSave,
  onDelete,
  onTest,
  onProvision,
  onRefresh,
}: {
  encoders: StreamEncoderInfo[];
  scenes: SceneMeta[];
  onSave: (body: EncoderSave) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onTest: (id: string) => Promise<ObsTestResult>;
  onProvision: (id: string) => Promise<ProvisionResult>;
  onRefresh: (id: string) => Promise<{ ok: boolean; error?: string }>;
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
        OBS encoders
      </Typography>
      <Typography variant="caption" color="text.secondary">
        One OBS instance per concurrent stream. Point each instance&apos;s browser source at a channel, then
        register its websocket endpoint here.
      </Typography>

      <Box sx={{ display: "grid", gap: 1, mt: 1.25 }}>
        {encoders.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No encoders registered — runs use the OBS_WEBSOCKET_URL instance (one stream at a time).
          </Typography>
        )}
        {encoders.map((enc) => (
          <Stack key={enc.id} direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Chip size="small" variant="outlined" label={enc.name || enc.id} />
            <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
              {enc.url}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {enc.sceneId ? `channel ${enc.sceneId}` : "any channel"}
              {enc.hasPassword ? " · password set" : ""}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <TestButton id={enc.id} onTest={onTest} />
            <ProvisionButton id={enc.id} onProvision={onProvision} />
            <RefreshButton id={enc.id} onRefresh={onRefresh} />
            <Switch
              size="small"
              checked={enc.enabled}
              onChange={(e) => run(() => onSave({ id: enc.id, url: enc.url, enabled: e.target.checked }))}
              slotProps={{ input: { "aria-label": `enable ${enc.name || enc.id}` } }}
            />
            <Button size="small" color="error" onClick={() => run(() => onDelete(enc.id))}>
              Remove
            </Button>
          </Stack>
        ))}
      </Box>

      <AddEncoderForm scenes={scenes} onSave={(body) => run(() => onSave(body))} />
      {err && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {err}
        </Alert>
      )}
    </Paper>
  );
}

/**
 * Read-only OBS reachability probe. Confirms the WORKER can reach this encoder's
 * obs-websocket (with the stored password) before you commit to a live broadcast —
 * it's the counterpart to the YouTube connect check. The result wraps onto its own
 * line (width: 100% inside the flex-wrap row).
 */
function TestButton({ id, onTest }: { id: string; onTest: (id: string) => Promise<ObsTestResult> }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ObsTestResult | null>(null);

  const test = async () => {
    setBusy(true);
    try {
      setRes(await onTest(id));
    } catch (e) {
      setRes({ reachable: false, error: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="small" onClick={test} disabled={busy}>
        {busy ? "Testing…" : "Test"}
      </Button>
      {res && (
        <Typography variant="caption" sx={{ width: "100%", color: res.reachable ? "success.main" : "error.main" }}>
          {res.reachable
            ? `✓ reached ${res.url} — OBS ${res.obsVersion} (ws ${res.websocketVersion}) · ${res.streaming ? "streaming now" : "idle"}`
            : `✗ ${res.error}`}
        </Typography>
      )}
    </>
  );
}

/**
 * Full auto-provision: push a full-canvas browser source (the channel's tokened
 * /watch URL) into this encoder's OBS and switch to it. The worker generates the
 * scene token if the channel has none, so one click makes the OBS instance show the
 * globe. Re-run after rotating a token to re-push the fresh URL.
 */
function ProvisionButton({ id, onProvision }: { id: string; onProvision: (id: string) => Promise<ProvisionResult> }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ProvisionResult | null>(null);

  const go = async () => {
    setBusy(true);
    try {
      setRes(await onProvision(id));
    } catch (e) {
      setRes({ ok: false, error: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="small" variant="outlined" onClick={go} disabled={busy}>
        {busy ? "Setting up…" : "Set up in OBS"}
      </Button>
      {res && (
        <Typography variant="caption" sx={{ width: "100%", color: res.ok ? "success.main" : "error.main" }}>
          {res.ok
            ? `✓ ${res.created ? "created" : "updated"} “${res.sceneName}” (${res.width}×${res.height})${res.switched ? " · switched OBS to it" : ""}${res.refreshed ? " · refreshed" : ""} — ${res.url}`
            : `✗ ${res.error}`}
        </Typography>
      )}
    </>
  );
}

/**
 * Force a no-cache reload of the encoder's globe browser source — picks up a new
 * /watch bundle after a deploy without re-switching scenes. No-op friendly: errors
 * if the source hasn't been provisioned yet.
 */
function RefreshButton({ id, onRefresh }: { id: string; onRefresh: (id: string) => Promise<{ ok: boolean; error?: string }> }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; error?: string } | null>(null);

  const go = async () => {
    setBusy(true);
    try {
      setRes(await onRefresh(id));
    } catch (e) {
      setRes({ ok: false, error: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="small" onClick={go} disabled={busy}>
        {busy ? "Refreshing…" : "Refresh"}
      </Button>
      {res && !res.ok && (
        <Typography variant="caption" sx={{ width: "100%", color: "error.main" }}>
          ✗ {res.error}
        </Typography>
      )}
    </>
  );
}

function AddEncoderForm({ scenes, onSave }: { scenes: SceneMeta[]; onSave: (body: EncoderSave) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [password, setPassword] = useState("");
  const [sceneId, setSceneId] = useState("");

  const add = () => {
    onSave({ name: name || undefined, url, password: password || undefined, sceneId: sceneId || undefined });
    setName("");
    setUrl("");
    setPassword("");
    setSceneId("");
  };

  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center", mt: 1.5 }}>
      <TextField label="name" value={name} onChange={(e) => setName(e.target.value)} sx={{ width: 130 }} />
      <TextField
        label="ws://host:4455"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        sx={{ flex: 1, minWidth: 180 }}
      />
      <TextField
        label="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        sx={{ width: 130 }}
      />
      <TextField select label="channel" value={sceneId} onChange={(e) => setSceneId(e.target.value)} sx={{ minWidth: 140 }}>
        <MenuItem value="">any</MenuItem>
        {scenes.map((s) => (
          <MenuItem key={s.id} value={s.id}>
            {s.name}
          </MenuItem>
        ))}
      </TextField>
      <Button variant="outlined" onClick={add} disabled={!/^wss?:\/\//.test(url)}>
        Add encoder
      </Button>
    </Stack>
  );
}
