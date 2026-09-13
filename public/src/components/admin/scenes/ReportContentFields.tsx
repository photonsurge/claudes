"use client";

/**
 * Feed & grid CONTENT for the top-right report — which event kinds are counted
 * and listed, and (when alerts are in) which hazards. Independent of which
 * slides show: this is what makes a "seismic" or "weather" channel's underlying
 * data actually differ. A kind turned off also drops its detection-grid column.
 */
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { REPORT_KINDS, type ReportKind } from "@photonsurge/shared/broadcast-report";
import type { HazardType } from "@photonsurge/shared/alerts/hazard";
import AlertHazardChips from "../../AlertHazardChips";

export default function ReportContentFields({
  kindsOff,
  hazardsOff,
  onKind,
  onHazards,
}: {
  kindsOff: ReadonlySet<string>;
  hazardsOff: HazardType[];
  onKind: (id: ReportKind, on: boolean) => void;
  onHazards: (next: HazardType[]) => void;
}) {
  return (
    <Box sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: "divider" }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Feed &amp; grid content
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        Which events are counted and listed in the active feed — a kind you turn off also
        drops its column from the detection grid.
      </Typography>
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", mb: 1 }}>
        {REPORT_KINDS.map((k) => (
          <FormControlLabel
            key={k.id}
            control={
              <Checkbox
                size="small"
                checked={!kindsOff.has(k.id)}
                onChange={(e) => onKind(k.id, e.target.checked)}
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
          <AlertHazardChips hazardsOff={hazardsOff} onChange={onHazards} />
        </Box>
      )}
    </Box>
  );
}
