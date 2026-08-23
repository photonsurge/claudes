"use client";

/**
 * Per-channel WORLD REPORT editor — which top-right report slides show, in what
 * order. This is how one globe becomes several themed channels: the focus
 * presets ("Weather focus", "Quakes & volcanoes") set the off-list in one click.
 * STAGED as a DELTA patch (reportOff / reportOrder) — the page's Save bar
 * applies it to /watch/:id.
 */
import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  BROADCAST_REPORT_SLIDES,
  REPORT_SLIDE_IDS,
  REPORT_PRESETS,
  REPORT_KINDS,
  type ReportSlideId,
  type ReportKind,
} from "@photonsurge/shared/broadcast-report";
import type { HazardType } from "@photonsurge/shared/alerts/hazard";
import { type ControlState } from "@photonsurge/shared/control";
import { fetchSceneState } from "../../../lib/scenes";
import { useSceneDraft } from "./SceneDraft";
import AlertHazardChips from "../../AlertHazardChips";

const REPORT_BY_ID = new Map(BROADCAST_REPORT_SLIDES.map((s) => [s.id, s]));

export default function ReportSettings({ sceneId }: { sceneId: string }) {
  const { stage: patch, epoch } = useSceneDraft();
  const [state, setState] = useState<ControlState | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSceneState(sceneId).then(({ state: s }) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId, epoch]);

  const off = useMemo(() => new Set<string>(state?.reportOff ?? []), [state]);

  const ordered = useMemo<ReportSlideId[]>(() => {
    const saved = (state?.reportOrder ?? []).filter((id) => REPORT_SLIDE_IDS.includes(id));
    const seen = new Set<string>(saved);
    const rest = REPORT_SLIDE_IDS.filter((id) => !seen.has(id));
    return [...saved, ...rest];
  }, [state]);

  const apply = (over: Partial<ControlState>) => {
    if (!state) return;
    setState({ ...state, ...over });
    patch(sceneId, over);
  };

  const setVisible = (id: ReportSlideId, visible: boolean) => {
    const next = new Set(off);
    if (visible) next.delete(id);
    else next.add(id);
    apply({ reportOff: [...next] as ReportSlideId[] });
  };

  const move = (id: ReportSlideId, dir: -1 | 1) => {
    const i = ordered.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    [next[i], next[j]] = [next[j], next[i]];
    apply({ reportOrder: next });
  };

  if (!state) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading channel…
      </Typography>
    );
  }

  const shownCount = REPORT_SLIDE_IDS.length - off.size;
  const kindsOff = new Set<string>(state.reportKindsOff ?? []);
  const activePreset = REPORT_PRESETS.find(
    (p) =>
      p.off.length === off.size &&
      p.off.every((id) => off.has(id)) &&
      p.kindsOff.length === kindsOff.size &&
      p.kindsOff.every((id) => kindsOff.has(id)),
  );

  const setKind = (id: ReportKind, on: boolean) => {
    const next = new Set(kindsOff);
    if (on) next.delete(id);
    else next.add(id);
    apply({ reportKindsOff: [...next] as ReportKind[] });
  };

  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        World report
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.25 }}>
        The top-right whole-planet deck. Pare it to this channel&apos;s theme — a focus preset is
        the fast way, then fine-tune below.
      </Typography>

      {/* One-click focuses — the multi-channel workhorse. */}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 1.5 }}>
        {REPORT_PRESETS.map((p) => (
          <Button
            key={p.id}
            size="small"
            variant={activePreset?.id === p.id ? "contained" : "outlined"}
            onClick={() => apply({ reportOff: [...p.off], reportKindsOff: [...p.kindsOff] })}
          >
            {p.label}
          </Button>
        ))}
      </Stack>

      <Box sx={{ display: "grid", gap: 0.5 }}>
        {ordered.map((id, idx) => {
          const s = REPORT_BY_ID.get(id);
          if (!s) return null;
          return (
            <Stack key={id} direction="row" spacing={1} sx={{ alignItems: "center", py: 0.25 }}>
              <Checkbox
                size="small"
                checked={!off.has(id)}
                onChange={(e) => setVisible(id, e.target.checked)}
                slotProps={{ input: { "aria-label": s.label } }}
                sx={{ p: 0.5 }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2">{s.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {s.note}
                </Typography>
              </Box>
              <IconButton
                size="small"
                disabled={idx === 0}
                onClick={() => move(id, -1)}
                aria-label={`Move ${s.label} up`}
                sx={{ p: 0.25, width: 24, height: 24 }}
              >
                ↑
              </IconButton>
              <IconButton
                size="small"
                disabled={idx === ordered.length - 1}
                onClick={() => move(id, 1)}
                aria-label={`Move ${s.label} down`}
                sx={{ p: 0.25, width: 24, height: 24 }}
              >
                ↓
              </IconButton>
            </Stack>
          );
        })}
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        {shownCount === 0
          ? "Nothing shown — the world report is hidden on this channel."
          : `${shownCount} of ${REPORT_SLIDE_IDS.length} slides shown.`}
      </Typography>

      {/* Feed & grid CONTENT — which event kinds/hazards are counted and fed,
          independent of which slides show. This is what makes a "seismic" or
          "weather" channel's data actually differ. */}
      <Box sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: "divider" }}>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Feed &amp; grid content
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          Which events are counted in the detection grid and listed in the active feed.
        </Typography>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", mb: 1 }}>
          {REPORT_KINDS.map((k) => (
            <FormControlLabel
              key={k.id}
              control={
                <Checkbox
                  size="small"
                  checked={!kindsOff.has(k.id)}
                  onChange={(e) => setKind(k.id, e.target.checked)}
                  slotProps={{ input: { "aria-label": k.label } }}
                  sx={{ p: 0.5 }}
                />
              }
              label={<Typography variant="body2">{k.label}</Typography>}
            />
          ))}
        </Stack>
        {!kindsOff.has("alert") && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Alert hazards
            </Typography>
            <AlertHazardChips
              hazardsOff={state.reportHazardsOff ?? []}
              onChange={(next: HazardType[]) => apply({ reportHazardsOff: next })}
            />
          </Box>
        )}
      </Box>
    </Paper>
  );
}
