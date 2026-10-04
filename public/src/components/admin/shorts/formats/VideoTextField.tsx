"use client";

/**
 * A video title or description template (docs/short-video-plan.md §6.8): the
 * field, the SAME token picker the live stream title has (its date and time
 * codes), a second chip group for the video's own `%{name}` values, and a live
 * preview resolved with `formatVideoText` — against the format's most recent
 * script's values when it has them, else the codes' example values. The
 * preview shows exactly what YouTube gets: a title trimmed to 100 characters
 * at a word, a description clipped as live descriptions are, and the length.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { STREAM_TITLE_TOKENS } from "@photonsurge/shared/stream-title";
import { VIDEO_TEXT_TOKENS, YT_DESCRIPTION_MAX, YT_TITLE_MAX, formatVideoText, type VideoTextValues } from "@photonsurge/shared/video-text";
import TokenChips from "../../../TokenChips";
import { previewTimeZone, previewVideoDescription, previewVideoTitle, textLength } from "../../../../lib/short-formats";

export default function VideoTextField({
  kind,
  value,
  onChange,
  values,
  valuesNote,
  timezone,
}: {
  kind: "title" | "description";
  value: string;
  onChange: (value: string) => void;
  /** What the `%{name}` codes resolve to in the preview. */
  values: VideoTextValues;
  /** Where those values came from, said under the preview. */
  valuesNote: string;
  /** The format's date-code zone ("place" previews in London). */
  timezone: string;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const isTitle = kind === "title";
  const resolved = now ? formatVideoText(value, values, now, previewTimeZone(timezone)) : "";
  const preview = now
    ? isTitle
      ? previewVideoTitle(value, values, now, timezone)
      : previewVideoDescription(value, values, now, timezone)
    : "";
  const length = isTitle ? textLength(resolved.trim()) : resolved.length;
  const max = isTitle ? YT_TITLE_MAX : YT_DESCRIPTION_MAX;
  const over = length > max;
  const zoneLabel = timezone === "place" ? "London time until render (the place's own zone then)" : `${previewTimeZone(timezone)} time`;
  // Stable, so the (memoised) chip groups don't re-render on every keystroke.
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const add = useCallback((code: string) => latest.current.onChange(latest.current.value + code), []);

  return (
    <Box sx={{ width: "100%", minWidth: 0 }}>
      <TextField
        fullWidth
        size="small"
        required={isTitle}
        multiline={!isTitle}
        minRows={isTitle ? undefined : 3}
        maxRows={isTitle ? undefined : 10}
        label={isTitle ? "Title" : "Description"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={isTitle && !value.trim()}
        helperText={
          isTitle
            ? value.trim()
              ? "Date codes and the video's own codes below. Resolved when the video is rendered."
              : "A title is required — an empty one keeps the saved title."
            : "The site link and the chapters are added underneath, as they are for live streams."
        }
      />
      <Box sx={{ mt: 1, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
        <Typography variant="overline" color="text.secondary">
          {isTitle ? "Title preview" : "Description preview"} · {zoneLabel}
        </Typography>
        <Typography
          variant="body2"
          component={isTitle ? "p" : "pre"}
          data-testid={`video-${kind}-preview`}
          sx={{ fontWeight: isTitle ? 600 : 400, whiteSpace: "pre-wrap", overflowWrap: "anywhere", m: 0, mb: 0.5, fontFamily: "inherit" }}
        >
          {preview || (isTitle ? "—" : "(empty)")}
        </Typography>
        <Typography variant="caption" color={over ? "warning.main" : "text.secondary"} component="p" data-testid={`video-${kind}-length`}>
          {length} / {max} characters
          {over ? (isTitle ? " — cut at a word with an ellipsis, as shown." : " — cut to the limit, as shown.") : ""}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
          {valuesNote}
        </Typography>
        <TokenChips title="Date & time codes — click a code to add it" tokens={STREAM_TITLE_TOKENS} onPick={add} open={isTitle} />
        <Box sx={{ mt: 1 }}>
          <TokenChips title="The video's own values — click a code to add it" tokens={VIDEO_TEXT_TOKENS} onPick={add} />
        </Box>
      </Box>
    </Box>
  );
}
