"use client";

/**
 * The token picker: a collapsible group of chips, one per code, each labelled
 * "code · label (example)". Clicking a chip hands its code up to be added to
 * the template. Used by the live stream title field and, with a second group
 * for the video's own values, by a short format's YouTube video card
 * (docs/short-video-plan.md §6.8 — "the same field as live titles").
 */
import { memo } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export type TokenDef = readonly [code: string, label: string, example: string];

/** Memoised: a field re-renders on every keystroke (and its preview every
 *  second), and the chips never change — pass a stable `onPick`. */
export default memo(function TokenChips({
  title,
  tokens,
  onPick,
  open = true,
}: {
  /** The group's summary line, e.g. "Date & time codes — click a code to add it". */
  title: string;
  tokens: readonly TokenDef[];
  onPick: (code: string) => void;
  /** Starts expanded. */
  open?: boolean;
}) {
  return (
    <Box component="details" open={open}>
      <Typography component="summary" variant="caption" sx={{ cursor: "pointer", fontWeight: 600 }}>
        {title}
      </Typography>
      <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: "wrap", mt: 1 }}>
        {tokens.map(([code, label, example]) => (
          <Chip key={code} size="small" variant="outlined" label={`${code} · ${label} (${example})`} onClick={() => onPick(code)} />
        ))}
      </Stack>
    </Box>
  );
});
