"use client";

/**
 * Per-channel on-air layout form: a grouped checklist of the optional broadcast
 * chrome widgets (top-right stack, gauges, legends, …). Each toggle adds/removes
 * a widget id from this channel's `ControlState.widgetsOff` off-list and STAGES
 * a DELTA patch (via useSceneDraft) — the page's Save bar applies it to
 * /watch/:id, without clobbering whatever the operator is driving live.
 */
import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import {
  BROADCAST_WIDGETS,
  WIDGET_IDS,
  WIDGET_ZONE_LABELS,
  WIDGET_ZONE_ORDER,
  type WidgetId,
} from "@photonsurge/shared/broadcast-widgets";
import { type ControlState } from "@photonsurge/shared/control";
import { fetchSceneState } from "../../../lib/scenes";
import { useSceneDraft } from "./SceneDraft";

export default function ChannelSettings({ sceneId }: { sceneId: string }) {
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

  const off = useMemo(() => new Set<string>(state?.widgetsOff ?? []), [state]);

  // Apply a new off-list: update local state immediately + emit/persist the delta.
  const applyOff = (nextOff: WidgetId[]) => {
    if (!state) return;
    setState({ ...state, widgetsOff: nextOff });
    patch(sceneId, { widgetsOff: nextOff });
  };

  const setVisible = (id: WidgetId, visible: boolean) => {
    const next = new Set(off);
    if (visible) next.delete(id);
    else next.add(id);
    applyOff([...next] as WidgetId[]);
  };

  if (!state) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading channel…
      </Typography>
    );
  }

  const anyHidden = off.size > 0;

  return (
    <Paper sx={{ p: 1.75 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          On-air widgets
        </Typography>
        <Button size="small" disabled={!anyHidden} onClick={() => applyOff([])}>
          Show all
        </Button>
        <Button
          size="small"
          disabled={off.size === WIDGET_IDS.length}
          onClick={() => applyOff([...WIDGET_IDS])}
        >
          Hide all
        </Button>
      </Stack>

      {!state.showBroadcastChrome && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          Broadcast chrome is off for this channel — these widgets stay hidden until it&apos;s
          turned on from the operator console.
        </Alert>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 1.5 }}>
        {WIDGET_ZONE_ORDER.map((zone) => {
          const widgets = BROADCAST_WIDGETS.filter((w) => w.zone === zone);
          if (widgets.length === 0) return null;
          return (
            <Box key={zone}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}
              >
                {WIDGET_ZONE_LABELS[zone]}
              </Typography>
              <FormGroup sx={{ mt: 0.5 }}>
                {widgets.map((w) => (
                  <FormControlLabel
                    key={w.id}
                    control={
                      <Checkbox
                        size="small"
                        checked={!off.has(w.id)}
                        onChange={(e) => setVisible(w.id, e.target.checked)}
                        slotProps={{ input: { "aria-label": w.label } }}
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body2">{w.label}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {w.hint}
                        </Typography>
                      </Box>
                    }
                    sx={{ alignItems: "flex-start", mb: 0.5 }}
                  />
                ))}
              </FormGroup>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
