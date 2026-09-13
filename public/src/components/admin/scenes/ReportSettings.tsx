"use client";

/**
 * Per-channel WORLD REPORT editor — which top-right report slides show, in what
 * order, how long each holds, the named point forecasts the weather slide uses
 * and which event kinds feed it. This is how one globe becomes several themed
 * channels: the focus presets ("Weather focus", "Quakes & volcanoes") set the
 * off-lists in one click. STAGED as DELTA patches — the page's Save bar applies
 * them to /watch/:id.
 */
import { useMemo } from "react";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import {
  REPORT_SLIDE_IDS,
  REPORT_PRESETS,
  DEFAULT_REPORT_HOLD_MS,
  DEFAULT_REPORT_RUNS,
  REPORT_HOLD_MIN_MS,
  REPORT_HOLD_MAX_MS,
  REPORT_RUNS_MIN,
  REPORT_RUNS_MAX,
  type ReportSlideId,
  type ReportKind,
} from "@photonsurge/shared/broadcast-report";
import type { HazardType } from "@photonsurge/shared/alerts/hazard";
import SettingsCard from "./SettingsCard";
import DwellField from "./DwellField";
import RunsField from "./RunsField";
import ReportOrderList from "./ReportOrderList";
import ReportLocationsField from "./ReportLocationsField";
import ReportContentFields from "./ReportContentFields";
import { useSceneDraft } from "./SceneDraft";

export default function ReportSettings() {
  const { state, stage } = useSceneDraft();

  const off = useMemo(() => new Set<string>(state.reportOff ?? []), [state.reportOff]);
  const kindsOff = useMemo(() => new Set<string>(state.reportKindsOff ?? []), [state.reportKindsOff]);

  const ordered = useMemo<ReportSlideId[]>(() => {
    const saved = (state.reportOrder ?? []).filter((id) => REPORT_SLIDE_IDS.includes(id));
    const seen = new Set<string>(saved);
    return [...saved, ...REPORT_SLIDE_IDS.filter((id) => !seen.has(id))];
  }, [state.reportOrder]);

  const activePreset = REPORT_PRESETS.find(
    (p) =>
      p.off.length === off.size &&
      p.off.every((id) => off.has(id)) &&
      p.kindsOff.length === kindsOff.size &&
      p.kindsOff.every((id) => kindsOff.has(id)),
  );

  const setVisible = (id: ReportSlideId, visible: boolean) => {
    const next = new Set(off);
    if (visible) next.delete(id);
    else next.add(id);
    stage({ reportOff: [...next] as ReportSlideId[] });
  };

  const setKind = (id: ReportKind, on: boolean) => {
    const next = new Set(kindsOff);
    if (on) next.delete(id);
    else next.add(id);
    stage({ reportKindsOff: [...next] as ReportKind[] });
  };

  const move = (id: ReportSlideId, dir: -1 | 1) => {
    const i = ordered.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    [next[i], next[j]] = [next[j], next[i]];
    stage({ reportOrder: next });
  };

  return (
    <SettingsCard
      id="report"
      blurb={
        <>
          The top-right report deck. Event slides are global; the weather slide uses only the
          locations chosen for this scene.
        </>
      }
    >
      {/* One-click focuses — the multi-channel workhorse. */}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 1.5 }}>
        {REPORT_PRESETS.map((p) => (
          <Button
            key={p.id}
            size="small"
            variant={activePreset?.id === p.id ? "contained" : "outlined"}
            onClick={() => stage({ reportOff: [...p.off], reportKindsOff: [...p.kindsOff] })}
          >
            {p.label}
          </Button>
        ))}
      </Stack>

      <RunsField
        label="Report runs through"
        hint="Laps of the slide's ACTIVE FEED — every row shown once — before the deck turns over. Slides with no feed hold the dwell below instead."
        value={state.reportRuns ?? DEFAULT_REPORT_RUNS}
        min={REPORT_RUNS_MIN}
        max={REPORT_RUNS_MAX}
        onChange={(runs) => stage({ reportRuns: runs })}
      />

      <DwellField
        label="Report minimum dwell"
        valueMs={state.reportHoldMs ?? DEFAULT_REPORT_HOLD_MS}
        defaultMs={DEFAULT_REPORT_HOLD_MS}
        minMs={REPORT_HOLD_MIN_MS}
        maxMs={REPORT_HOLD_MAX_MS}
        onChange={(ms) => stage({ reportHoldMs: ms })}
      />

      <ReportLocationsField
        locations={state.weatherLocations ?? []}
        camera={state.camera}
        onChange={(weatherLocations) => stage({ weatherLocations })}
      />

      <ReportOrderList ordered={ordered} off={off} onToggle={setVisible} onMove={move} />

      <ReportContentFields
        kindsOff={kindsOff}
        hazardsOff={state.reportHazardsOff ?? []}
        onKind={setKind}
        onHazards={(next: HazardType[]) => stage({ reportHazardsOff: next })}
      />
    </SettingsCard>
  );
}
