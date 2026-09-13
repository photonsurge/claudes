"use client";

/**
 * Per-channel on-air layout form: a grouped checklist of the optional broadcast
 * chrome widgets (top-right stack, gauges, legends, …). Each toggle adds/removes
 * a widget id from this channel's `ControlState.widgetsOff` off-list and STAGES
 * a DELTA patch — the page's Save bar applies it to /watch/:id, without
 * clobbering whatever the operator is driving live.
 */
import { useMemo } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Typography from "@mui/material/Typography";
import {
  BROADCAST_WIDGETS,
  WIDGET_IDS,
  WIDGET_ZONE_LABELS,
  WIDGET_ZONE_ORDER,
  type WidgetId,
} from "@photonsurge/shared/broadcast-widgets";
import SettingsCard from "./SettingsCard";
import { useSceneDraft } from "./SceneDraft";

export default function ChannelSettings() {
  const { state, stage } = useSceneDraft();

  const off = useMemo(() => new Set<string>(state.widgetsOff ?? []), [state.widgetsOff]);

  const setVisible = (id: WidgetId, visible: boolean) => {
    const next = new Set(off);
    if (visible) next.delete(id);
    else next.add(id);
    stage({ widgetsOff: [...next] as WidgetId[] });
  };

  const anyHidden = off.size > 0;

  return (
    <SettingsCard
      id="widgets"
      actions={
        <>
          <Button size="small" disabled={!anyHidden} onClick={() => stage({ widgetsOff: [] })}>
            Show all
          </Button>
          <Button
            size="small"
            disabled={off.size === WIDGET_IDS.length}
            onClick={() => stage({ widgetsOff: [...WIDGET_IDS] })}
          >
            Hide all
          </Button>
        </>
      }
    >
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
    </SettingsCard>
  );
}
