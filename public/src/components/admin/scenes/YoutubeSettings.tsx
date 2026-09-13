"use client";

/**
 * Per-channel YouTube publishing card: the title and description templates and
 * the thumbnail image every broadcast on this channel is created with. Rides
 * ControlState.youtube and is STAGED as a DELTA patch — the page's Save bar
 * applies it without clobbering the operator's live state. Templates resolve
 * once, when the worker creates the broadcast; a run/slot title still overrides
 * the channel's. Empty fields fall back to the built-in defaults (automatic
 * title, the globe blurb, the horizontal logo).
 */
import Stack from "@mui/material/Stack";
import type { ControlState } from "@photonsurge/shared/control";
import StreamDescriptionField from "../../StreamDescriptionField";
import StreamThumbnailField from "../../StreamThumbnailField";
import StreamTitleField from "../../StreamTitleField";
import SettingsCard from "./SettingsCard";
import { useSceneDraft } from "./SceneDraft";

export default function YoutubeSettings() {
  const { state, stage } = useSceneDraft();
  const youtube = state.youtube;

  // Staged deltas spread-merge at the TOP level, so every change ships the
  // whole youtube object rebuilt from the merged draft.
  const apply = (over: Partial<ControlState["youtube"]>) =>
    stage({ youtube: { ...youtube, ...over } });

  return (
    <SettingsCard
      id="youtube"
      note={
        <>
          Every stream started on this channel — one-off runs from /control and its constant streams —
          is created on YouTube with this title, description and thumbnail. Codes are resolved when the
          broadcast is created; a title typed on a constant stream or in the stream panel overrides the
          channel&apos;s. A video that is already live keeps what it was created with.
        </>
      }
    >
      <Stack spacing={2}>
        <StreamTitleField value={youtube.title} onChange={(title) => apply({ title })} recurring />
        <StreamDescriptionField
          value={youtube.description}
          onChange={(description) => apply({ description })}
          recurring
        />
        <StreamThumbnailField value={youtube.thumbnailUrl} onChange={(thumbnailUrl) => apply({ thumbnailUrl })} />
      </Stack>
    </SettingsCard>
  );
}
