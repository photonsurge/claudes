"use client";

/**
 * /admin/streams — the streaming-runs fleet view. Connect a YouTube channel, start
 * a bounded/unbounded run on any scene (OBS + YouTube), watch every run's live
 * status, and stop runs. The per-scene quick controls also live in the operator
 * console (/control StreamPanel); this page is the cross-scene manager.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Typography from "@mui/material/Typography";
import { MAIN_SCENE_ID, type SceneMeta } from "@photonsurge/shared/control";
import { runIsActive, type RunState } from "@photonsurge/shared/runs";
import { listScenes } from "../../../lib/scenes";
import { useStreams, startStream, stopStream, connectYoutube, disconnectYoutube } from "../../../lib/stream";
import AdminPageShell from "../../../components/admin/AdminPageShell";

const STATUS_COLOR: Record<string, "default" | "error" | "warning" | "success"> = {
  scheduled: "warning",
  "awaiting-ingest": "warning",
  live: "error",
  ending: "warning",
  ended: "default",
  stopped: "default",
  failed: "error",
};

export default function StreamsPage() {
  const { snapshot, error, refetch, activeRunFor } = useStreams();
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  // Read the OAuth callback result from the URL directly (avoids useSearchParams'
  // Suspense-boundary requirement in the App Router).
  const [notice, setNotice] = useState<{ connected?: string; oauthError?: string }>({});
  const { connected, oauthError } = notice;

  useEffect(() => {
    listScenes().then(setScenes).catch(() => {});
    const q = new URLSearchParams(window.location.search);
    setNotice({ connected: q.get("connected") ?? undefined, oauthError: q.get("error") ?? undefined });
  }, []);

  const account = snapshot?.accounts?.[0];
  const runs = snapshot?.runs ?? [];

  return (
    <AdminPageShell
      title="Streams"
      description={
        <>
          Start time-boxed live runs on any scene, publishing to YouTube via OBS. Per-scene quick
          controls also live in the <MuiLink component={Link} href="/control">operator console</MuiLink>.
        </>
      }
      maxWidth={860}
    >
      {connected && (
        <Alert severity="success" sx={{ mt: 1 }}>
          Connected YouTube channel: {decodeURIComponent(connected)}
        </Alert>
      )}
      {oauthError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          YouTube connect failed: {decodeURIComponent(oauthError)}
        </Alert>
      )}
      {error && error !== "admin only" && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}

      {/* Platform connections */}
      <Paper sx={{ p: 1.75, mt: 1.75 }}>
        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            YouTube
          </Typography>
          {account ? (
            <>
              <Chip color="success" label={account.channelTitle || account.channelId} />
              <Button
                variant="outlined"
                color="error"
                size="small"
                onClick={async () => {
                  if (confirm("Disconnect this YouTube channel?")) {
                    await disconnectYoutube(account.channelId);
                    refetch();
                  }
                }}
              >
                Disconnect
              </Button>
            </>
          ) : snapshot?.youtubeConfigured ? (
            <Button variant="contained" onClick={connectYoutube}>
              Connect YouTube
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Not configured — set YOUTUBE_CLIENT_ID/SECRET/REDIRECT_URI in .env
            </Typography>
          )}
          <Chip
            variant="outlined"
            color={snapshot?.obsConfigured ? "success" : "default"}
            label={snapshot?.obsConfigured ? "OBS configured" : "OBS: manual handoff"}
          />
        </Stack>
      </Paper>

      <StartRunForm
        scenes={scenes}
        canPublish={!!snapshot?.youtubeConfigured && !!account}
        activeRunFor={activeRunFor}
        onStarted={refetch}
      />

      {/* Runs */}
      <Box sx={{ display: "grid", gap: 1.25, mt: 2.25 }}>
        {runs.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No runs yet.
          </Typography>
        )}
        {runs.map((run) => (
          <RunRow key={run.id} run={run} onStopped={refetch} />
        ))}
      </Box>
    </AdminPageShell>
  );
}

function StartRunForm({
  scenes,
  canPublish,
  activeRunFor,
  onStarted,
}: {
  scenes: SceneMeta[];
  canPublish: boolean;
  activeRunFor: (sceneId: string) => RunState | null;
  onStarted: () => void;
}) {
  const [sceneId, setSceneId] = useState<string>(MAIN_SCENE_ID);
  const [title, setTitle] = useState("");
  const [publishYoutube, setPublishYoutube] = useState(true);
  const [durationMin, setDurationMin] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sceneBusy = !!activeRunFor(sceneId);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await startStream({
        sceneId,
        title: title || undefined,
        durationMs: durationMin > 0 ? durationMin * 60_000 : null,
        platforms: { youtube: publishYoutube && canPublish },
      });
      setTitle("");
      onStarted();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper sx={{ p: 1.75, mt: 1.75 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField
          select
          label="scene"
          value={scenes.some((s) => s.id === sceneId) || sceneId === MAIN_SCENE_ID ? sceneId : ""}
          onChange={(e) => setSceneId(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          {scenes.length === 0 && <MenuItem value={MAIN_SCENE_ID}>Main</MenuItem>}
          {scenes.map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          sx={{ flex: 1, minWidth: 180 }}
        />
        <TextField
          type="number"
          label="auto-end (min, 0=∞)"
          value={durationMin}
          onChange={(e) => setDurationMin(Math.max(0, Number(e.target.value) || 0))}
          sx={{ width: 160 }}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={publishYoutube && canPublish}
              disabled={!canPublish}
              onChange={(e) => setPublishYoutube(e.target.checked)}
            />
          }
          label="YouTube"
        />
        <Button variant="contained" color="error" onClick={go} disabled={busy || sceneBusy}>
          {busy ? "…" : sceneBusy ? "Scene busy" : "● Go Live"}
        </Button>
      </Stack>
      {err && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {err}
        </Alert>
      )}
    </Paper>
  );
}

function RunRow({ run, onStopped }: { run: RunState; onStopped: () => void }) {
  const [busy, setBusy] = useState(false);
  const active = runIsActive(run.status);

  const stop = async () => {
    setBusy(true);
    try {
      await stopStream(run.id);
      onStopped();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper sx={{ p: 1.75 }}>
      <Stack direction="row" spacing={1.75} sx={{ alignItems: "center" }}>
        <Chip size="small" color={STATUS_COLOR[run.status] ?? "default"} label={run.status} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {run.title || run.sceneId}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            scene {run.sceneId}
            {run.needsManualObs ? " · OBS manual handoff needed" : ""}
            {run.error ? ` · ${run.error.step}: ${run.error.message}` : ""}
          </Typography>
        </Box>
        {run.youtube?.watchUrl && (
          <MuiLink href={run.youtube.watchUrl} target="_blank" variant="body2" sx={{ whiteSpace: "nowrap" }}>
            Watch ↗
          </MuiLink>
        )}
        {active && (
          <Button variant="outlined" color="error" onClick={stop} disabled={busy}>
            {busy ? "…" : "Stop"}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
