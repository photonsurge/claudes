"use client";

/**
 * The YouTube group (plan §8.2, §10): which YouTube channel this crossword
 * channel goes out on, and the title, description and thumbnail each broadcast
 * is created with. All of it rides the channel record's `youtube` field, the
 * same one the weather card stages, so the streaming code reads it unchanged.
 *
 * The channel is chosen from the connected accounts and never guessed: with
 * none stored, go-live is refused for a crossword channel. An account whose
 * token Google rejected shows as needing a reconnect and cannot be chosen.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import MenuItem from "@mui/material/MenuItem";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { ControlState } from "@photonsurge/shared/control";
import StreamDescriptionField from "../../../StreamDescriptionField";
import StreamThumbnailField from "../../../StreamThumbnailField";
import StreamTitleField from "../../../StreamTitleField";
import ChannelCard from "./ChannelCard";
import { useChannelDraft } from "./ChannelDraft";
import { fetchYoutubeChannels, type YoutubeChannel } from "./client";

/** Staged deltas spread-merge at the top level, so every change ships the whole youtube object. */
function useYoutubeStage() {
  const { state, stage } = useChannelDraft();
  const youtube = state.youtube;
  return { youtube, apply: (over: Partial<ControlState["youtube"]>) => stage({ youtube: { ...youtube, ...over } }) };
}

export function YoutubeChannelCard() {
  const { youtube, apply } = useYoutubeStage();
  const [channels, setChannels] = useState<YoutubeChannel[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchYoutubeChannels().then((c) => live && setChannels(c));
    return () => {
      live = false;
    };
  }, []);

  const chosen = youtube.accountId ?? "";
  const list = channels ?? [];
  const known = list.find((c) => c.id === chosen);
  const broken = known?.needsReconnect;

  return (
    <ChannelCard
      id="youtube-channel"
      blurb="The YouTube channel this crossword goes out on. Connect channels on the YouTube page."
    >
      <TextField
        select
        size="small"
        label="Goes out on"
        value={channels === null ? "" : chosen}
        disabled={channels === null}
        onChange={(e) => apply({ accountId: e.target.value })}
        sx={{ minWidth: 280 }}
      >
        <MenuItem value="">None chosen</MenuItem>
        {list.map((c) => (
          <MenuItem key={c.id} value={c.id} disabled={c.needsReconnect}>
            {c.title}
            {c.needsReconnect ? " — needs reconnect" : ""}
          </MenuItem>
        ))}
        {chosen && !known && channels !== null && (
          <MenuItem value={chosen} disabled>
            {chosen} — no longer connected
          </MenuItem>
        )}
      </TextField>
      {channels !== null && list.length === 0 && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          No YouTube channel is connected. Connect one on the{" "}
          <MuiLink component={Link} href="/admin/youtube">YouTube page</MuiLink>.
        </Alert>
      )}
      {!chosen && list.length > 0 && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          With no channel chosen, going live is refused for a crossword channel.
        </Alert>
      )}
      {broken && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          Google rejected this channel&apos;s token. Reconnect it on the{" "}
          <MuiLink component={Link} href="/admin/youtube">YouTube page</MuiLink> before going live.
        </Alert>
      )}
    </ChannelCard>
  );
}

export function YoutubeBroadcastCard() {
  const { youtube, apply } = useYoutubeStage();
  return (
    <ChannelCard
      id="youtube-broadcast"
      note="Codes are resolved when the broadcast is created; a title typed on a run overrides the channel's. A video that is already live keeps what it was created with."
    >
      <Stack spacing={2}>
        <StreamTitleField value={youtube.title} onChange={(title) => apply({ title })} recurring />
        <StreamDescriptionField value={youtube.description} onChange={(description) => apply({ description })} recurring />
        <StreamThumbnailField value={youtube.thumbnailUrl} onChange={(thumbnailUrl) => apply({ thumbnailUrl })} />
      </Stack>
    </ChannelCard>
  );
}
