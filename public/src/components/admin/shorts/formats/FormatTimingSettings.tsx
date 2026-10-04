"use client";

/**
 * Timing card (§5.2 `timing`): the slack around the script inside the
 * broadcast — the script starts this long after the stream goes live, and the
 * run ends this long after the script does. Stages the whole `timing` field.
 */
import Box from "@mui/material/Box";
import {
  DEFAULT_LEAD_IN_MS,
  DEFAULT_LEAD_OUT_MS,
  FORMAT_TIMING_MAX_MS,
  type ShortFormat,
} from "@photonsurge/shared/short-format";
import SettingsCard from "../../scenes/SettingsCard";
import TuningField from "../../scenes/TuningField";
import { useSceneDraft } from "../../scenes/SceneDraft";

export default function FormatTimingSettings() {
  const { format, stageFormat } = useSceneDraft();
  if (!format) return null;
  const tm = format.timing;
  const set = (over: Partial<ShortFormat["timing"]>) => stageFormat({ timing: { ...tm, ...over } });

  return (
    <SettingsCard
      id="timing"
      blurb="A rendered video is a bounded live broadcast. The lead-in covers YouTube's start; the lead-out keeps the last shot on the video past the pipeline delay."
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
        <TuningField
          label="Lead-in"
          value={tm.leadInMs / 1000}
          defaultValue={DEFAULT_LEAD_IN_MS / 1000}
          min={0}
          max={FORMAT_TIMING_MAX_MS / 1000}
          unit="s"
          onChange={(v) => set({ leadInMs: Math.round(v * 1000) })}
        />
        <TuningField
          label="Lead-out"
          value={tm.leadOutMs / 1000}
          defaultValue={DEFAULT_LEAD_OUT_MS / 1000}
          min={0}
          max={FORMAT_TIMING_MAX_MS / 1000}
          unit="s"
          onChange={(v) => set({ leadOutMs: Math.round(v * 1000) })}
        />
      </Box>
    </SettingsCard>
  );
}
