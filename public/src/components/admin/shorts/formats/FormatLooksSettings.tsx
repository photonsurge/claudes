"use client";

/**
 * Looks and thresholds (§5.5): new on a settings page — for channels these
 * live on /control's director panel, and this card reuses that panel's own
 * sections over the format's draft: the transition time and the alert and
 * quake thresholds (`DirectorTuning`), and the look per shot type
 * (`DirectorSlides`). Edits stage into the director bucket and go out with
 * the page's one Save.
 *
 * Two things differ from /control:
 *  • the kinds listed are the shots a script plays (the place round-ups, the
 *    world spin and the event clips), not the director kinds the format's
 *    scene happened to copy from its channel — a short doesn't use those;
 *  • "Save as new" snapshots the FORMAT's own scene (the draft's look), not
 *    a live map, and nothing is pushed to air until Save.
 */
import Box from "@mui/material/Box";
import type { DirectorConfig, SegmentKind } from "@photonsurge/shared/director";
import DirectorSlides from "../../../DirectorSlides";
import DirectorTuning from "../../../DirectorTuning";
import SettingsCard from "../../scenes/SettingsCard";
import { useSceneDraft } from "../../scenes/SceneDraft";

/** The segment kinds a short's clips play as (script targets, short-script.ts). */
export const SHORT_SHOT_KINDS: readonly SegmentKind[] = ["global", "country", "region", "storm", "quake", "volcano"];

/** The draft config as the /control sections should see it on a short: only
 *  a script's shot kinds on (and so no ad cadence). */
export function shortKindsView(config: DirectorConfig): DirectorConfig {
  const kinds = Object.fromEntries(Object.keys(config.kinds).map((k) => [k, SHORT_SHOT_KINDS.includes(k as SegmentKind)]));
  for (const k of SHORT_SHOT_KINDS) kinds[k] = true;
  return { ...config, kinds: kinds as DirectorConfig["kinds"] };
}

export default function FormatLooksSettings() {
  const { config, state, stageDirector } = useSceneDraft();
  const view = shortKindsView(config);

  return (
    <SettingsCard
      id="looks"
      blurb="How shots move and look in this format, and which events are big enough to air. The same sections as the director panel on /control."
    >
      {/* The /control sections style their own sliders inside .director-panel. */}
      <Box
        className="director-panel"
        sx={{
          "& input[type=range]": { accentColor: (t) => t.palette.primary.main },
          "& button": { color: "inherit" },
        }}
      >
        <DirectorTuning config={view} update={stageDirector} />
        <Box sx={{ mt: 2 }}>
          <DirectorSlides config={view} update={stageDirector} liveState={state} applyLive={() => {}} />
        </Box>
      </Box>
    </SettingsCard>
  );
}
