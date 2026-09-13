"use client";

/**
 * Per-channel ABOUT card editor: the copy on the top-right WORLD REPORT deck's
 * ABOUT slide — the channel's own description, its data-source credits and the
 * small-print footnote. All of it rides ControlState.about and is STAGED as a
 * DELTA patch — the page's Save bar applies it to /watch/:id without clobbering
 * the operator's live state. Empty fields fall back to the built-in G.O.D.S.
 * copy, so an untouched channel reads exactly as before.
 */
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { ControlState } from "@photonsurge/shared/control";
import SettingsCard from "./SettingsCard";
import { useSceneDraft } from "./SceneDraft";

export default function AboutCardSettings() {
  const { state, stage } = useSceneDraft();
  const about = state.about;

  // Staged deltas spread-merge at the TOP level, so every change ships the
  // whole about object rebuilt from the merged draft.
  const apply = (over: Partial<ControlState["about"]>) => stage({ about: { ...about, ...over } });

  return (
    <SettingsCard
      id="about"
      note={
        <>
          The ABOUT slide in this channel&apos;s top-right WORLD REPORT rotation — its own
          description and the data sources it uses. Show, hide or reorder the slide itself
          in the top-right report card.
        </>
      }
    >
      <Stack spacing={1.5}>
        <TextField
          size="small"
          label="Title"
          value={about.title}
          onChange={(e) => apply({ title: e.target.value })}
          placeholder="About G.O.D.S."
          slotProps={{ htmlInput: { "aria-label": "About title" } }}
        />
        <TextField
          size="small"
          label="Body"
          multiline
          minRows={5}
          value={about.body}
          onChange={(e) => apply({ body: e.target.value })}
          helperText="A blank line starts a new paragraph. Empty = the built-in G.O.D.S. description."
          slotProps={{ htmlInput: { "aria-label": "About body" } }}
        />
        <TextField
          size="small"
          label="Data sources"
          multiline
          minRows={2}
          value={about.sources}
          onChange={(e) => apply({ sources: e.target.value })}
          helperText="One per line or comma-separated — e.g. NOAA GFS, USGS, GDACS. Empty = no sources line."
          slotProps={{ htmlInput: { "aria-label": "About sources" } }}
        />
        <TextField
          size="small"
          label="Footnote"
          multiline
          minRows={2}
          value={about.footer}
          onChange={(e) => apply({ footer: e.target.value })}
          helperText="Small print under the divider. Empty = the standard not-an-official-warning-service disclaimer."
          slotProps={{ htmlInput: { "aria-label": "About footnote" } }}
        />
      </Stack>
    </SettingsCard>
  );
}
