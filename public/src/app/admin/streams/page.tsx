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
import { DEFAULT_CHAT_POLL_MS, fmtChatPoll, runIsActive, type RunState, type StreamHealth, type StreamEncoderInfo, type YoutubePrivacy } from "@photonsurge/shared/runs";
import { listScenes } from "../../../lib/scenes";
import {
  useStreams,
  useYoutubeVideoStats,
  type YoutubeVideoStats,
  startStream,
  stopStream,
  connectYoutube,
  disconnectYoutube,
  saveEncoder,
  deleteEncoder,
  testEncoder,
  provisionEncoder,
  refreshEncoder,
  saveSlot,
  deleteSlot,
  type StreamAccount,
} from "../../../lib/stream";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import EncodersCard from "../../../components/admin/streams/EncodersCard";
import SlotsCard from "../../../components/admin/streams/SlotsCard";
import ChatPollSelect from "../../../components/admin/streams/ChatPollSelect";
import RunChatDialog from "../../../components/admin/streams/RunChatDialog";
import RunStats from "../../../components/admin/streams/RunStats";
import StreamTitleField from "../../../components/StreamTitleField";

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
  const { snapshot, health, error, refetch, activeRunFor } = useStreams();
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

  const accounts = snapshot?.accounts ?? [];
  const encoders = snapshot?.encoders ?? [];
  const runs = snapshot?.runs ?? [];
  const { stats: youtubeStats, error: statsError } = useYoutubeVideoStats(runs.some((r) => !!r.youtube?.broadcastId));

  return (
    <AdminPageShell
      title="Streams"
      description={
        <>
          Multi-channel streaming: register one OBS encoder per concurrent stream, keep constant streams
          alive via slots, or start one-off runs. Per-channel quick controls also live in the{" "}
          <MuiLink component={Link} href="/control">operator console</MuiLink>.
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
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            YouTube channels
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            color={snapshot?.obsConfigured ? "success" : "default"}
            label={snapshot?.obsConfigured ? "OBS configured" : "OBS: manual handoff"}
          />
        </Stack>

        {snapshot && !snapshot.youtubeConfigured && (
          <Typography variant="caption" color="text.secondary">
            Not configured — set GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI in .env
          </Typography>
        )}

        {accounts.length > 0 && (
          <Box sx={{ display: "grid", gap: 0.75, mb: 1 }}>
            {accounts.map((acct) => (
              <Stack key={acct.channelId} direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Chip size="small" color="success" label={acct.channelTitle || acct.channelId} />
                <Box sx={{ flex: 1 }} />
                <Button
                  variant="text"
                  color="error"
                  size="small"
                  onClick={async () => {
                    if (confirm(`Disconnect "${acct.channelTitle || acct.channelId}"?`)) {
                      await disconnectYoutube(acct.channelId);
                      refetch();
                    }
                  }}
                >
                  Disconnect
                </Button>
              </Stack>
            ))}
          </Box>
        )}

        {snapshot?.youtubeConfigured && (
          <Button variant={accounts.length ? "outlined" : "contained"} size="small" onClick={connectYoutube}>
            {accounts.length ? "Connect another channel" : "Connect YouTube"}
          </Button>
        )}
      </Paper>

      <EncodersCard
        encoders={snapshot?.encoders ?? []}
        scenes={scenes}
        onSave={async (body) => {
          await saveEncoder(body);
          refetch();
        }}
        onDelete={async (id) => {
          await deleteEncoder(id);
          refetch();
        }}
        onTest={testEncoder}
        onProvision={provisionEncoder}
        onRefresh={refreshEncoder}
      />

      <SlotsCard
        slots={snapshot?.slots ?? []}
        scenes={scenes}
        encoders={encoders}
        accounts={accounts}
        runs={runs}
        onSave={async (body) => {
          await saveSlot(body);
          refetch();
        }}
        onDelete={async (id) => {
          await deleteSlot(id);
          refetch();
        }}
      />

      <StartRunForm
        scenes={scenes}
        encoders={encoders}
        accounts={accounts}
        canPublish={!!snapshot?.youtubeConfigured && accounts.length > 0}
        activeRunFor={activeRunFor}
        onStarted={refetch}
      />

      {/* Runs */}
      {statsError && <Alert severity="warning" sx={{ mt: 2 }}>{statsError}</Alert>}
      <Box sx={{ display: "grid", gap: 1.25, mt: 2.25 }}>
        {runs.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No runs yet.
          </Typography>
        )}
        {runs.map((run) => (
          <RunRow key={run.id} run={run} health={health?.[run.id]} youtubeStats={youtubeStats[run.id]} statsError={statsError} onStopped={refetch} />
        ))}
      </Box>
    </AdminPageShell>
  );
}

function StartRunForm({
  scenes,
  encoders,
  accounts,
  canPublish,
  activeRunFor,
  onStarted,
}: {
  scenes: SceneMeta[];
  encoders: StreamEncoderInfo[];
  accounts: StreamAccount[];
  canPublish: boolean;
  activeRunFor: (sceneId: string) => RunState | null;
  onStarted: () => void;
}) {
  const [sceneId, setSceneId] = useState<string>(MAIN_SCENE_ID);
  const [encoderId, setEncoderId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [title, setTitle] = useState("");
  const [privacy, setPrivacy] = useState<YoutubePrivacy>("unlisted");
  const [publishYoutube, setPublishYoutube] = useState(true);
  const [durationMin, setDurationMin] = useState(0);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [promoteToTicker, setPromoteToTicker] = useState(false);
  const [chatPollMs, setChatPollMs] = useState<number | null>(DEFAULT_CHAT_POLL_MS);
  const [announce, setAnnounce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sceneBusy = !!activeRunFor(sceneId);
  const publishing = publishYoutube && canPublish;

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await startStream({
        sceneId,
        encoderId: encoderId || undefined,
        accountId: publishing && accountId ? accountId : undefined,
        title: title || undefined,
        privacy,
        durationMs: durationMin > 0 ? durationMin * 60_000 : null,
        platforms: { youtube: publishing },
        chat: { enabled: chatEnabled, promoteToTicker: chatEnabled && promoteToTicker, pollEveryMs: chatPollMs },
        announce,
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
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
        One-off run
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField
          select
          label="channel"
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
        <StreamTitleField value={title} onChange={setTitle} />
        {canPublish && (
          <TextField
            select
            label="YouTube"
            value={accounts.some((a) => a.channelId === accountId) ? accountId : ""}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={!publishing}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">Default channel</MenuItem>
            {accounts.map((a) => (
              <MenuItem key={a.channelId} value={a.channelId}>
                {a.channelTitle || a.channelId}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          select
          label="privacy"
          value={privacy}
          onChange={(e) => setPrivacy(e.target.value as YoutubePrivacy)}
          disabled={!publishing}
          sx={{ minWidth: 110 }}
        >
          <MenuItem value="public">Public</MenuItem>
          <MenuItem value="unlisted">Unlisted</MenuItem>
          <MenuItem value="private">Private</MenuItem>
        </TextField>
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
              checked={publishing}
              disabled={!canPublish}
              onChange={(e) => setPublishYoutube(e.target.checked)}
            />
          }
          label="YouTube"
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
        {chatEnabled && <ChatPollSelect value={chatPollMs} onChange={setChatPollMs} />}
        <FormControlLabel
          control={<Checkbox checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />}
          label="📣 notify"
          title="Notify the world at go-live: publish a hydra blog post + social fan-out with the watch URL"
        />
        <Button variant="contained" color="error" onClick={go} disabled={busy || sceneBusy}>
          {busy ? "…" : sceneBusy ? "Channel busy" : "● Go Live"}
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

function RunRow({ run, health, youtubeStats, statsError, onStopped }: { run: RunState; health?: StreamHealth; youtubeStats?: YoutubeVideoStats; statsError?: string | null; onStopped: () => void }) {
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
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
            {run.encoderId ? ` · encoder ${run.encoderId}` : ""}
            {run.slotId ? " · constant" : ""}
            {run.chat?.enabled ? `${run.chat.promoteToTicker ? " · chat→ticker" : " · chat"} ${fmtChatPoll(run.chat.pollEveryMs)}` : ""}
            {run.announce ? (run.announcedAt ? " · 📣 announced" : run.announceError ? ` · 📣 announce failed (try ${run.announceError.attempts}${run.announceError.status ? `, HTTP ${run.announceError.status}` : ""}): ${run.announceError.message}` : " · 📣") : ""}
            {run.chapters?.publishedAt ? " · ⏱ chapters" : run.chapters?.error ? " · ⏱ chapters failed" : ""}
            {run.needsManualObs ? " · OBS manual handoff needed" : ""}
            {run.error ? ` · ${run.error.step}: ${run.error.message}` : ""}
          </Typography>
        </Box>
        {run.youtube?.watchUrl && (
          <MuiLink href={run.youtube.watchUrl} target="_blank" variant="body2" sx={{ whiteSpace: "nowrap" }}>
            Watch ↗
          </MuiLink>
        )}
        <MuiLink component={Link} href={`/admin/streams/${encodeURIComponent(run.id)}`} variant="body2" sx={{ whiteSpace: "nowrap" }}>
          As-run
        </MuiLink>
        <Button variant="outlined" size="small" onClick={() => setChatOpen(true)}>
          Chat
        </Button>
        {active && (
          <Button variant="outlined" color="error" onClick={stop} disabled={busy}>
            {busy ? "…" : "Stop"}
          </Button>
        )}
      </Stack>
      <RunStats run={run} health={health} youtubeStats={youtubeStats} statsError={statsError} />
      <RunChatDialog runId={run.id} title={run.title || run.sceneId} open={chatOpen} onClose={() => setChatOpen(false)} />
    </Paper>
  );
}
