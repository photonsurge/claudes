"use client";

/**
 * The Go live dialog (crossword plan §10): the one-off run form with the channel
 * filled in, opened from a row of the Channels list (both kinds) and from the
 * crossword Desk. It posts the same `POST /api/streams` the one-off run form on
 * /admin/streams does, with the encoder and YouTube account it picked.
 *
 *  - Encoder: `EncoderSelect`, each with what it is doing; a live, held or
 *    rendering one can't be chosen. Starts on the encoder bound to this
 *    channel when that one is free, else "auto" for weather. A crossword has
 *    no "auto" (it would land on the default OBS the picker never shows): it
 *    starts on the first free channel encoder, and with none it can't go live.
 *    The post carries `strictEncoder`, so the server checks the same and also
 *    refuses an encoder held by an always-on slot.
 *  - YouTube channel: preselected from the channel record (`youtube.accountId`)
 *    and named on the button ("Go live on <YouTube channel>"); it can be changed
 *    for this one run. An account that needs reconnecting can't be chosen. A
 *    weather channel may leave it on the default account, as today; a crossword
 *    channel can't — with none stored or picked it is refused (the server
 *    refuses too).
 *  - Privacy, title (the channel's YouTube title template, changeable for this
 *    run) and duration (0 = open-ended). The description is the channel's.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MuiLink from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { sceneSurface, type SceneMeta } from "@photonsurge/shared/control";
import { encoderUse, runIsActive, type RunState, type YoutubePrivacy } from "@photonsurge/shared/runs";
import EncoderSelect, { encoderBusy } from "./EncoderSelect";
import StreamTitleField from "../../StreamTitleField";
import { fetchSceneState } from "../../../lib/scenes";
import { startStream, type StreamSnapshot } from "../../../lib/stream";

/** The value of the YouTube select meaning "the default account" (weather only). */
const DEFAULT_ACCOUNT = "";

interface Props {
  open: boolean;
  /** The channel going live: id, name, kind and its stored YouTube account. */
  scene: Pick<SceneMeta, "id" | "name" | "surface" | "youtubeAccountId">;
  onClose: () => void;
  /** Called with the created run once the server accepts it. */
  onStarted?: (run: RunState) => void;
}

async function loadSnapshot(): Promise<StreamSnapshot | null> {
  try {
    const res = await fetch("/api/streams", { cache: "no-store" });
    return res.ok ? ((await res.json()) as StreamSnapshot) : null;
  } catch {
    return null;
  }
}

export default function GoLiveDialog({ open, scene, onClose, onStarted }: Props) {
  const crossword = sceneSurface(scene) === "crossword";
  const [snapshot, setSnapshot] = useState<StreamSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [encoderId, setEncoderId] = useState("");
  const [accountId, setAccountId] = useState(DEFAULT_ACCOUNT);
  const [privacy, setPrivacy] = useState<YoutubePrivacy>("unlisted");
  const [title, setTitle] = useState("");
  const [durationMin, setDurationMin] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh each time it opens: what the encoders are doing changes by the minute.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoaded(false);
    setError(null);
    Promise.all([loadSnapshot(), fetchSceneState(scene.id)]).then(([snap, sceneState]) => {
      if (!live) return;
      setSnapshot(snap);
      const encoders = snap?.encoders ?? [];
      const free = (e: (typeof encoders)[number]) => e.enabled && !encoderBusy(e) && encoderUse(e) !== "videos";
      const own = encoders.find((e) => e.sceneId === scene.id && free(e));
      // A crossword names its encoder (no "auto" onto the default OBS, §10):
      // its own when free, else the first free channel encoder.
      setEncoderId(own?.id ?? (crossword ? encoders.find(free)?.id ?? "" : ""));
      const stored = scene.youtubeAccountId ?? "";
      const usable = (snap?.accounts ?? []).some((a) => a.channelId === stored && !a.needsReconnect);
      setAccountId(usable ? stored : DEFAULT_ACCOUNT);
      setTitle(sceneState?.ok ? sceneState.state.youtube?.title ?? "" : "");
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [open, scene.id, scene.youtubeAccountId, crossword]);

  const accounts = useMemo(() => snapshot?.accounts ?? [], [snapshot]);
  const picked = accounts.find((a) => a.channelId === accountId);
  const pickedName = picked ? picked.channelTitle || picked.channelId : null;
  const storedMissing =
    !!scene.youtubeAccountId && scene.youtubeAccountId !== accountId && accountId === DEFAULT_ACCOUNT;
  // A weather channel's empty pick means its STORED account when it has one
  // (the server uses it), so a broken stored account is named, not "Default".
  const storedAccount = accounts.find((a) => a.channelId === scene.youtubeAccountId);
  const storedUsable = !!storedAccount && !storedAccount.needsReconnect;
  const storedBroken = !crossword && !!scene.youtubeAccountId && !storedUsable && accountId === DEFAULT_ACCOUNT;
  const storedLabel =
    scene.youtubeAccountId && !storedUsable
      ? `${storedAccount?.channelTitle || scene.youtubeAccountId} (stored, ${storedAccount ? "needs reconnecting" : "not connected"})`
      : null;
  const noEncoder = crossword && !encoderId;
  const sceneBusy = !!snapshot?.runs.some((r) => r.sceneId === scene.id && runIsActive(r.status));
  const youtubeConfigured = snapshot?.youtubeConfigured !== false;
  // A crossword channel never goes out on a guessed account (§10).
  const noAccount = crossword && !pickedName;

  const buttonLabel = busy
    ? "…"
    : sceneBusy
      ? "Channel busy"
      : pickedName
        ? `Go live on ${pickedName}`
        : crossword || storedBroken
          ? "Go live"
          : "Go live on the default channel";

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const run = await startStream({
        sceneId: scene.id,
        encoderId: encoderId || undefined,
        accountId: accountId || undefined,
        title: title.trim() || undefined,
        privacy,
        durationMs: durationMin > 0 ? durationMin * 60_000 : null,
        platforms: { youtube: true },
        // The dialog's encoder rules, checked again by the server (§10).
        strictEncoder: true,
      } as Parameters<typeof startStream>[0]);
      onStarted?.(run);
      onClose();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Go live: {scene.name || scene.id}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {loaded && !youtubeConfigured && <Alert severity="error">YouTube is not configured on the server.</Alert>}
          {sceneBusy && (
            <Alert severity="info">
              This channel is already on air. Follow it on{" "}
              <MuiLink component={Link} href="/admin/streams">
                Streams
              </MuiLink>
              .
            </Alert>
          )}
          <EncoderSelect
            purpose="channel"
            refuseBusy
            encoders={snapshot?.encoders ?? []}
            value={encoderId}
            onChange={setEncoderId}
            label="Encoder"
            emptyLabel="auto (this channel's encoder, else the default OBS)"
            noAuto={crossword}
            disabled={!loaded}
          />
          {loaded && noEncoder && (
            <Alert severity="warning">
              No encoder is free for this crossword channel. It never goes out on the default OBS by itself: free one on{" "}
              <MuiLink component={Link} href="/admin/streams">
                Streams
              </MuiLink>{" "}
              first.
            </Alert>
          )}
          <TextField
            select
            label="YouTube channel"
            value={accounts.some((a) => a.channelId === accountId) ? accountId : DEFAULT_ACCOUNT}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={!loaded}
            helperText={
              noAccount
                ? "This crossword channel has no YouTube channel. Pick one, or set it on the channel's Settings page."
                : storedBroken
                  ? "This channel's stored YouTube channel can't be used: reconnect it on /admin/youtube, or pick another for this run."
                  : storedMissing
                    ? "The channel's own YouTube channel is not connected or needs reconnecting."
                    : "Changing it here applies to this run only."
            }
            slotProps={{
              // Show the empty pick's own label ("Default channel", a stored account that can't be used).
              select: { displayEmpty: true },
              formHelperText: noAccount || storedMissing ? { sx: { color: "warning.main" } } : undefined,
            }}
          >
            {crossword ? (
              <MenuItem value={DEFAULT_ACCOUNT} disabled>
                Pick a YouTube channel
              </MenuItem>
            ) : storedLabel ? (
              <MenuItem value={DEFAULT_ACCOUNT} disabled>
                {storedLabel}
              </MenuItem>
            ) : scene.youtubeAccountId ? null : (
              // With an account stored, an empty pick would mean that one, not a default.
              <MenuItem value={DEFAULT_ACCOUNT}>Default channel</MenuItem>
            )}
            {accounts.map((a) => (
              <MenuItem key={a.channelId} value={a.channelId} disabled={!!a.needsReconnect}>
                {a.channelTitle || a.channelId}
                {a.needsReconnect ? " (needs reconnecting)" : ""}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1.5}>
            <TextField
              select
              label="Privacy"
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value as YoutubePrivacy)}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="public">Public</MenuItem>
              <MenuItem value="unlisted">Unlisted</MenuItem>
              <MenuItem value="private">Private</MenuItem>
            </TextField>
            <TextField
              type="number"
              label="Duration (min)"
              value={durationMin}
              onChange={(e) => setDurationMin(Math.max(0, Number(e.target.value) || 0))}
              helperText={durationMin > 0 ? `ends after ${durationMin} min` : "open-ended: runs until stopped"}
              sx={{ width: 200 }}
            />
          </Stack>
          <StreamTitleField value={title} onChange={setTitle} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={go}
          disabled={!loaded || busy || sceneBusy || noAccount || noEncoder || storedBroken || !youtubeConfigured}
        >
          {buttonLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
