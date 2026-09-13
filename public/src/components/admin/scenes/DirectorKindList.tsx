"use client";

/**
 * The auto-director's slide-type checklist: tick a segment kind to make it
 * eligible, and pick how often it comes up. The intro is the one-time session
 * opener and never enters rotation, so it carries no frequency.
 */
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { SEGMENT_KINDS, type SegmentKind } from "@photonsurge/shared/director";
import { KIND_LABEL } from "../../../lib/kind-labels";

/** Airtime-multiplier presets for the per-kind frequency picker. */
const WEIGHT_PRESETS: { w: number; label: string }[] = [
  { w: 0.5, label: "Rarely · ×0.5" },
  { w: 1, label: "Normal · ×1" },
  { w: 2, label: "Often · ×2" },
  { w: 4, label: "Lots · ×4" },
];

export default function DirectorKindList({
  kinds,
  weights,
  onKind,
  onWeight,
}: {
  kinds: Partial<Record<SegmentKind, boolean>>;
  weights: Partial<Record<SegmentKind, number>> | undefined;
  onKind: (k: SegmentKind, on: boolean) => void;
  onWeight: (k: SegmentKind, w: number) => void;
}) {
  return (
    <Box sx={{ display: "grid", gap: 0.25, mb: 1.5 }}>
      {SEGMENT_KINDS.map((k) => {
        const on = !!kinds[k];
        const weight = weights?.[k] ?? 1;
        // A non-preset persisted weight still needs an option to sit on, or MUI warns.
        const weightOptions = WEIGHT_PRESETS.some((p) => p.w === weight)
          ? WEIGHT_PRESETS
          : [...WEIGHT_PRESETS, { w: weight, label: `×${weight}` }];
        return (
          <Stack key={k} direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Checkbox
              size="small"
              checked={on}
              onChange={(e) => onKind(k, e.target.checked)}
              slotProps={{ input: { "aria-label": KIND_LABEL[k] } }}
              sx={{ p: 0.5 }}
            />
            <Typography variant="body2" sx={{ flex: 1 }}>
              {KIND_LABEL[k]}
            </Typography>
            {on && k !== "intro" && (
              <TextField
                select
                size="small"
                value={weight}
                onChange={(e) => onWeight(k, Number(e.target.value))}
                sx={{ width: 130 }}
                slotProps={{ htmlInput: { "aria-label": `${KIND_LABEL[k]} frequency` } }}
              >
                {weightOptions.map((p) => (
                  <MenuItem key={p.w} value={p.w}>
                    {p.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
        );
      })}
    </Box>
  );
}
