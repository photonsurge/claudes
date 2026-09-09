"use client";

/**
 * OBS encoder registry card for /admin/streams. One OBS instance = one concurrent
 * stream, so multi-view needs one card here per constant stream. Each encoder is its
 * own bordered block: the obs-websocket endpoint, the bound channel (with the exact
 * tokened /watch URL that channel resolves to), the diagnostic/provision actions, and
 * their results tied to that encoder. The websocket password is write-only (stored
 * encrypted server-side).
 */
import { useState, type ReactNode } from "react";
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

interface EncoderActions {
  onSave: (body: EncoderSave) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onTest: (id: string) => Promise<ObsTestResult>;
  onProvision: (id: string) => Promise<ProvisionResult>;
  onRefresh: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

export default function EncodersCard({
  encoders,
  scenes,
  ...actions
}: { encoders: StreamEncoderInfo[]; scenes: SceneMeta[] } & EncoderActions) {
  const [err, setErr] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const runAdd = async (body: EncoderSave) => {
    setErr(null);
    try {
      await actions.onSave(body);
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
        One OBS instance per concurrent stream. Bind each to a channel, then{" "}
        <b>Set up in OBS</b> pushes that channel&apos;s tokened /watch URL into it as a full-canvas browser source.
      </Typography>

      <Box sx={{ display: "grid", gap: 1.25, mt: 1.25 }}>
        {encoders.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No encoders registered — runs use the OBS_WEBSOCKET_URL instance (one stream at a time).
          </Typography>
        )}
        {encoders.map((enc) => (
          <EncoderRow key={enc.id} enc={enc} scenes={scenes} origin={origin} {...actions} />
        ))}
      </Box>

      <AddEncoderForm scenes={scenes} onSave={runAdd} />
      {err && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {err}
        </Alert>
      )}
    </Paper>
  );
}

/** One registered encoder: identity, channel + its watch URL, actions, and results. */
function EncoderRow({
  enc,
  scenes,
  origin,
  onSave,
  onDelete,
  onTest,
  onProvision,
  onRefresh,
}: { enc: StreamEncoderInfo; scenes: SceneMeta[]; origin: string } & EncoderActions) {
  const [busy, setBusy] = useState<null | "test" | "prov" | "refresh" | "save" | "delete">(null);
  const [test, setTest] = useState<ObsTestResult | null>(null);
  const [prov, setProv] = useState<ProvisionResult | null>(null);
  const [refreshErr, setRefreshErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const scene = scenes.find((s) => s.id === enc.sceneId);
  const watchUrl = enc.sceneId
    ? `${origin}/watch/${enc.sceneId}${scene?.watchToken ? `?token=${scene.watchToken}` : ""}`
    : null;

  const guard = (which: typeof busy, fn: () => Promise<void>) => async () => {
    setBusy(which);
    setActionErr(null);
    try {
      await fn();
    } catch (e) {
      setActionErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const doTest = guard("test", async () => setTest(await onTest(enc.id)));
  const doProv = guard("prov", async () => setProv(await onProvision(enc.id)));
  const doRefresh = guard("refresh", async () => {
    const r = await onRefresh(enc.id);
    setRefreshErr(r.ok ? null : (r.error ?? "refresh failed"));
  });
  const changeChannel = (sceneId: string) =>
    guard("save", async () => {
      await onSave({ id: enc.id, url: enc.url, sceneId });
      setProv(null); // the URL changed — the old provision line no longer applies
    })();
  const toggle = (enabled: boolean) => guard("save", () => onSave({ id: enc.id, url: enc.url, enabled }).then(() => {}))();
  const remove = guard("delete", () => onDelete(enc.id).then(() => {}));

  const copy = () => {
    if (!watchUrl) return;
    navigator.clipboard?.writeText(watchUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack spacing={1}>
        {/* Identity + enable/remove */}
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Chip size="small" variant="outlined" label={enc.name || enc.id} />
          <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
            {enc.url}
          </Typography>
          <Typography variant="caption" color={enc.hasPassword ? "text.secondary" : "warning.main"}>
            {enc.hasPassword ? "password set" : "no password"}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <Typography variant="caption" color="text.secondary">
              {enc.enabled ? "on" : "off"}
            </Typography>
            <Switch
              size="small"
              checked={enc.enabled}
              disabled={busy === "save"}
              onChange={(e) => toggle(e.target.checked)}
              slotProps={{ input: { "aria-label": `enable ${enc.name || enc.id}` } }}
            />
          </Stack>
          <Button size="small" color="error" disabled={busy === "delete"} onClick={remove}>
            Remove
          </Button>
        </Stack>

        {/* Channel binding + its tokened watch URL */}
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <TextField
            select
            size="small"
            label="channel"
            value={scenes.some((s) => s.id === enc.sceneId) ? enc.sceneId : ""}
            disabled={busy === "save"}
            onChange={(e) => changeChannel(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">any (unbound)</MenuItem>
            {scenes.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
          {watchUrl ? (
            <>
              <Box
                component="code"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: "monospace",
                  fontSize: 12,
                  color: "text.secondary",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={watchUrl}
              >
                {watchUrl}
              </Box>
              <Button size="small" onClick={copy}>
                {copied ? "Copied" : "Copy URL"}
              </Button>
            </>
          ) : (
            <Typography variant="caption" color="warning.main">
              bind a channel to set this instance&apos;s watch URL
            </Typography>
          )}
        </Stack>

        {/* Actions */}
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Button size="small" onClick={doTest} disabled={busy === "test"}>
            {busy === "test" ? "Testing…" : "Test"}
          </Button>
          <Button size="small" variant="outlined" onClick={doProv} disabled={busy === "prov" || !enc.sceneId}>
            {busy === "prov" ? "Setting up…" : "Set up in OBS"}
          </Button>
          <Button size="small" onClick={doRefresh} disabled={busy === "refresh"}>
            {busy === "refresh" ? "Refreshing…" : "Refresh"}
          </Button>
        </Stack>

        {/* Results — each tied to THIS encoder */}
        {test && (
          <ResultLine ok={test.reachable}>
            {test.reachable
              ? `reached ${test.url} — OBS ${test.obsVersion} (ws ${test.websocketVersion}) · ${test.streaming ? "streaming now" : "idle"}${describeService(test)}`
              : test.error}
          </ResultLine>
        )}
        {prov && (
          <ResultLine ok={prov.ok}>
            {prov.ok
              ? `${prov.created ? "created" : "updated"} “${prov.sceneName}” (${prov.width}×${prov.height})${prov.switched ? " · switched OBS to it" : ""}${prov.refreshed ? " · refreshed" : ""}${describeSweep(prov)}`
              : prov.error}
          </ResultLine>
        )}
        {refreshErr && <ResultLine ok={false}>{refreshErr}</ResultLine>}
        {actionErr && <ResultLine ok={false}>{actionErr}</ResultLine>}
      </Stack>
    </Paper>
  );
}

/** " · stream: rtmp_custom → rtmp://… (key set) · last: OBS_WEBSOCKET_OUTPUT_STOPPED" from a probe. */
function describeService(test: ObsTestResult): string {
  const parts: string[] = [];
  if (test.service) {
    const { type, server, keySet } = test.service;
    parts.push(`stream: ${type}${server ? ` → ${server}` : ""} (${keySet ? "key set" : "no key"})`);
  }
  if (test.lastState) parts.push(`last: ${test.lastState.replace(/^OBS_WEBSOCKET_OUTPUT_/, "").toLowerCase()}`);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

/**
 * What the provision swept out of this OBS instance. Worth saying out loud: a
 * browser source left over from another channel keeps running (and holding its
 * socket + textures) even while hidden, so "3 stray sources removed" is the line
 * that explains a sudden drop in this encoder's dropped-frame count.
 */
function describeSweep(prov: ProvisionResult): string {
  const parts: string[] = [];
  const inputs = prov.removedInputs?.length ?? 0;
  const scenes = prov.removedScenes?.length ?? 0;
  if (inputs) parts.push(`${inputs} stray source${inputs === 1 ? "" : "s"}`);
  if (scenes) parts.push(`${scenes} scene${scenes === 1 ? "" : "s"}`);
  return parts.length ? ` · swept ${parts.join(" + ")}` : "";
}

function ResultLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <Typography variant="caption" sx={{ color: ok ? "success.main" : "error.main" }}>
      {ok ? "✓ " : "✗ "}
      {children}
    </Typography>
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
