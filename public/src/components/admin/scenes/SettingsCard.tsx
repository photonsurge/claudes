"use client";

/**
 * The shell every card on `/admin/scenes/:id` renders into: the paper, the
 * heading row with its optional actions, an optional blurb under the heading,
 * the form itself and an optional closing note.
 *
 * It exists so card number twelve looks like card number one — the eleven
 * hand-rolled copies of this had already drifted apart on spacing and on
 * whether the explainer sat above or below the controls (it sits below, as a
 * note). The heading text comes from the catalog, not from the card, because
 * the rail and the Save bar have to name the same card the same way.
 *
 * The `id` is also the page anchor, so `/admin/scenes/:id#youtube` lands here.
 */
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { getCard } from "./catalog";
import { useSceneDraft } from "./SceneDraft";

export default function SettingsCard({
  id,
  blurb,
  actions,
  note,
  children,
}: {
  id: string;
  blurb?: ReactNode;
  actions?: ReactNode;
  /** Closing explainer, rendered as an info alert under the controls. */
  note?: ReactNode;
  children: ReactNode;
}) {
  const { pending, pendingDirector } = useSceneDraft();
  const def = getCard(id);
  const staged = def?.bucket === "director" ? pendingDirector : pending;
  const dirty = !!def && def.fields.some((f) => f in staged);

  return (
    <Paper id={id} component="section" aria-labelledby={`${id}-title`} sx={{ p: 1.75, scrollMarginTop: 88 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", mb: blurb ? 0.5 : 1.25, flexWrap: "wrap", rowGap: 1 }}
      >
        <Typography id={`${id}-title`} variant="subtitle2" sx={{ flex: 1 }}>
          {def?.title ?? id}
        </Typography>
        {dirty && (
          <Typography
            variant="caption"
            sx={{ color: "warning.main", fontWeight: 700, whiteSpace: "nowrap" }}
          >
            • unsaved
          </Typography>
        )}
        {actions}
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
