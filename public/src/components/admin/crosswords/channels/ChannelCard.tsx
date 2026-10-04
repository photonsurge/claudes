"use client";

/**
 * The shell every card on the crossword settings page renders into: the paper,
 * the catalog's title, an "unsaved" mark while the card has a staged edit, an
 * optional blurb and closing note. The weather page's SettingsCard, over this
 * page's draft.
 */
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { changedCards, getChannelCard } from "./catalog";
import { useChannelDraft } from "./ChannelDraft";

export default function ChannelCard({
  id,
  blurb,
  note,
  children,
}: {
  id: string;
  blurb?: ReactNode;
  /** Closing explainer, rendered as an info alert under the controls. */
  note?: ReactNode;
  children: ReactNode;
}) {
  const { pending, pendingCrossword, saved } = useChannelDraft();
  const def = getChannelCard(id);
  const dirty = changedCards(pending, pendingCrossword, saved.youtube).some((c) => c.id === id);

  return (
    <Paper id={id} component="section" aria-labelledby={`${id}-title`} sx={{ p: 1.75, scrollMarginTop: 88 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: blurb ? 0.5 : 1.25 }}>
        <Typography id={`${id}-title`} variant="subtitle2" sx={{ flex: 1 }}>
          {def?.title ?? id}
        </Typography>
        {dirty && (
          <Typography variant="caption" sx={{ color: "warning.main", fontWeight: 700, whiteSpace: "nowrap" }}>
            • unsaved
          </Typography>
        )}
      </Stack>
      {blurb ? (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.25 }}>
          {blurb}
        </Typography>
      ) : null}
      {children}
      {note ? (
        <Box sx={{ mt: 1.5 }}>
          <Alert severity="info">{note}</Alert>
        </Box>
      ) : null}
    </Paper>
  );
}
