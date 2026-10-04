"use client";

/**
 * YouTube video card (docs/short-video-plan.md §6.8): everything YouTube is
 * told about a video of this format — title and description templates (with
 * the token picker and a live preview), the zone the date codes resolve in,
 * the thumbnail, tags, category, playlist, privacy and chapters. Stages the
 * whole `video` field.
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DEFAULT_VIDEO_TIMEZONE, MAX_VIDEO_TAGS, PLACE_TIMEZONE, type ShortFormat } from "@photonsurge/shared/short-format";
import type { YoutubePrivacy } from "@photonsurge/shared/runs";
import { formatVideoText, isValidTimeZone } from "@photonsurge/shared/video-text";
import SettingsCard from "../../scenes/SettingsCard";
import { useSceneDraft } from "../../scenes/SceneDraft";
import { YOUTUBE_CATEGORIES } from "../../../../lib/short-formats";
import VideoTextField from "./VideoTextField";
import { previewValues, useFormatScript } from "./format-script";

type ZoneMode = "london" | "place" | "other";

const zoneModeOf = (tz: string): ZoneMode =>
  tz === PLACE_TIMEZONE ? "place" : tz === DEFAULT_VIDEO_TIMEZONE ? "london" : "other";

/** Where a newly picked frame thumbnail sits: a few seconds into the first clip. */
const DEFAULT_FRAME_AT_MS = 5_000;

export default function FormatVideoSettings() {
  const { format, stageFormat } = useSceneDraft();
  const script = useFormatScript();
  if (!format) return null;
  return <VideoForm format={format} stageFormat={stageFormat} script={script} />;
}

function VideoForm({
  format,
  stageFormat,
  script,
}: {
  format: ShortFormat;
  stageFormat: ReturnType<typeof useSceneDraft>["stageFormat"];
  script: ReturnType<typeof useFormatScript>;
}) {
  const v = format.video;
  const set = (over: Partial<ShortFormat["video"]>) => stageFormat({ video: { ...v, ...over } });
  const { values, note } = previewValues(script, format.name);

  // The zone picker: London, the place's own, or another IANA zone. A zone
  // being typed stays local until Intl knows it — only a valid one is staged.
  const [mode, setMode] = useState<ZoneMode>(zoneModeOf(v.timezone));
  const [zoneText, setZoneText] = useState(zoneModeOf(v.timezone) === "other" ? v.timezone : "");
  const zoneValid = isValidTimeZone(zoneText.trim());
  // Follow the draft when it changes under us (a Discard, a typed zone landing):
  // keep "another zone" open while one is still being typed.
  useEffect(() => {
    const m = zoneModeOf(v.timezone);
    setMode((cur) => (cur === "other" && m === "london" ? cur : m));
    if (m === "other") setZoneText((cur) => (cur.trim() === v.timezone ? cur : v.timezone));
  }, [v.timezone]);
  const pickMode = (m: ZoneMode) => {
    setMode(m);
    if (m === "london") set({ timezone: DEFAULT_VIDEO_TIMEZONE });
    else if (m === "place") set({ timezone: PLACE_TIMEZONE });
    else if (zoneValid) set({ timezone: zoneText.trim() });
  };
  const typeZone = (text: string) => {
    setZoneText(text);
    if (isValidTimeZone(text.trim())) set({ timezone: text.trim() });
  };

  const [tagText, setTagText] = useState("");
  const addTags = (raw: string) => {
    const fresh = raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && !v.tags.includes(t));
    if (fresh.length) set({ tags: [...v.tags, ...new Set(fresh)].slice(0, MAX_VIDEO_TAGS) });
    setTagText("");
  };

  const thumb = v.thumbnail;
  const thumbUrl = thumb.source === "image" ? thumb.url : "";
  const thumbPreview = thumbUrl ? formatVideoText(thumbUrl, values) : "";
  const categoryKnown = YOUTUBE_CATEGORIES.some((c) => c.id === v.categoryId);

  return (
    <SettingsCard
      id="youtube-video"
      blurb="What YouTube is told about each video of this format. This format's videos don't use the channel YouTube card."
    >
      <Stack spacing={2.5}>
        <VideoTextField kind="title" value={v.title} onChange={(title) => set({ title })} values={values} valuesNote={note} timezone={v.timezone} />
        <VideoTextField
          kind="description"
          value={v.description}
          onChange={(description) => set({ description })}
          values={values}
          valuesNote={note}
          timezone={v.timezone}
        />

        <div>
          <Typography variant="subtitle2">Time zone for date codes</Typography>
          <RadioGroup row value={mode} onChange={(e) => pickMode(e.target.value as ZoneMode)} aria-label="Time zone for date codes">
            <FormControlLabel value="london" control={<Radio size="small" />} label="London (as live titles)" />
            <FormControlLabel value="place" control={<Radio size="small" />} label="The place's own" />
            <FormControlLabel value="other" control={<Radio size="small" />} label="Another zone" />
          </RadioGroup>
          {mode === "other" && (
            <TextField
              size="small"
              label="IANA time zone"
              placeholder="Australia/Sydney"
              value={zoneText}
              onChange={(e) => typeZone(e.target.value)}
              error={!!zoneText && !zoneValid}
              helperText={
                zoneText && !zoneValid
                  ? "Not a time zone this browser knows — the saved zone stays until it is."
                  : "An IANA zone name, e.g. Australia/Sydney or America/New_York."
              }
              sx={{ maxWidth: 360 }}
            />
          )}
          {mode === "place" && (
            <Typography variant="caption" color="text.secondary" component="p">
              Dated in the video&apos;s own place. A video of several places has no single place and uses London.
            </Typography>
          )}
        </div>

        <div>
          <Typography variant="subtitle2">Thumbnail</Typography>
          <RadioGroup
            row
            value={thumb.source}
            onChange={(e) =>
              e.target.value === "frame"
                ? set({ thumbnail: { source: "frame", atMs: thumb.source === "frame" ? thumb.atMs : DEFAULT_FRAME_AT_MS } })
                : set({ thumbnail: { source: "image", url: thumbUrl } })
            }
            aria-label="Thumbnail source"
          >
            <FormControlLabel value="image" control={<Radio size="small" />} label="An image" />
            <FormControlLabel value="frame" control={<Radio size="small" />} label="A frame of the video" />
          </RadioGroup>
          {thumb.source === "image" ? (
            <TextField
              fullWidth
              size="small"
              label="Image URL or site path"
              placeholder="/thumbs/%{placeId}.png"
              value={thumbUrl}
              onChange={(e) => set({ thumbnail: { source: "image", url: e.target.value } })}
              helperText={
                thumbPreview
                  ? `Resolves to ${thumbPreview} — takes the same codes as the title; use %{placeId} in paths.`
                  : "Empty = no thumbnail of its own. Takes the same codes as the title; use %{placeId} in paths."
              }
            />
          ) : (
            <TextField
              size="small"
              type="number"
              label="Seconds into the script"
              value={Math.round(thumb.atMs / 100) / 10}
              onChange={(e) => {
                const sec = Number(e.target.value);
                set({ thumbnail: { source: "frame", atMs: Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : 0 } });
              }}
              slotProps={{ htmlInput: { min: 0, step: 0.5 } }}
              helperText="OBS takes this frame during a live render and uploads it as the thumbnail. Counted from the first clip; past the end, the last frame."
              sx={{ maxWidth: 360 }}
            />
          )}
        </div>

        <div>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Tags
          </Typography>
          <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: "wrap", mb: v.tags.length ? 1 : 0 }}>
            {v.tags.map((t) => (
              <Chip key={t} size="small" label={t} onDelete={() => set({ tags: v.tags.filter((x) => x !== t) })} />
            ))}
          </Stack>
          <TextField
            size="small"
            label="Add tags"
            value={tagText}
            onChange={(e) => (e.target.value.endsWith(",") ? addTags(e.target.value) : setTagText(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTags(tagText);
              }
            }}
            onBlur={() => tagText.trim() && addTags(tagText)}
            helperText="Enter or a comma adds a tag."
            sx={{ maxWidth: 360 }}
          />
        </div>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
          <TextField
            select
            size="small"
            label="Category"
            value={v.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}
            sx={{ minWidth: 220 }}
          >
            {YOUTUBE_CATEGORIES.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.label}
              </MenuItem>
            ))}
            {!categoryKnown && <MenuItem value={v.categoryId}>Category {v.categoryId}</MenuItem>}
          </TextField>
          <TextField
            select
            size="small"
            label="Publish as"
            value={v.publishAs}
            onChange={(e) => set({ publishAs: e.target.value as YoutubePrivacy })}
            helperText="Applied when the render ends."
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="public">Public</MenuItem>
            <MenuItem value="unlisted">Unlisted</MenuItem>
            <MenuItem value="private">Private</MenuItem>
          </TextField>
          <TextField
            size="small"
            label="Playlist id"
            placeholder="PL…"
            value={v.playlistId ?? ""}
            onChange={(e) => {
              const playlistId = e.target.value;
              const next: ShortFormat["video"] = { ...v, playlistId };
              if (!playlistId) delete next.playlistId;
              stageFormat({ video: next });
            }}
            helperText="The finished video is added to it. Empty = none."
            sx={{ minWidth: 220 }}
          />
        </Box>

        <FormControlLabel
          control={<Switch checked={v.chapters} onChange={(e) => set({ chapters: e.target.checked })} />}
          label="Chapters in the description"
        />
      </Stack>
    </SettingsCard>
  );
}
