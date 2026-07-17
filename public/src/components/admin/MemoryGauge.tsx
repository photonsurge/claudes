"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { font } from "../../theme/tokens";

/**
 * A horizontal memory gauge: a filled bar for `value` against `max`, an optional
 * peak tick (high-water mark), and a value/max readout. The fill goes amber then
 * red as it approaches `max` — this is the OOM early-warning, so "getting full"
 * has to read at a glance. Used on /admin/health for rss and JS-heap.
 */
export default function MemoryGauge({
  label,
  value,
  max,
  peak,
  hint,
}: {
  label: string;
  /** Current value, in MB. */
  value: number;
  /** Full-scale, in MB (the ceiling — heap limit, or a soft rss cap). */
  max: number;
  /** High-water mark, in MB — drawn as a tick if past `value`. */
  peak?: number;
  /** Small note under the readout (e.g. what the ceiling is). */
  hint?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));
  const peakPct = peak != null ? Math.min(100, Math.max(0, (peak / safeMax) * 100)) : null;
  // Colour by fullness: the closer to the ceiling, the hotter.
  const color = pct >= 90 ? "error.main" : pct >= 70 ? "warning.main" : "primary.main";
  const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${Math.round(mb)}MB`);

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "baseline", mb: 0.5 }}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.5 }}>
          {label}
        </Typography>
        <Typography
          variant="body2"
          sx={{ ml: "auto", fontFamily: font.mono, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}
        >
          {gb(value)}
          <Box component="span" sx={{ color: "text.disabled", fontWeight: 400 }}>
            {" "}
            / {gb(max)}
          </Box>
        </Typography>
      </Stack>
      <Box sx={{ position: "relative", height: 12, borderRadius: 1, bgcolor: "action.hover", overflow: "hidden" }}>
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            bgcolor: color,
            borderRadius: 1,
            transition: "width 400ms ease, background-color 400ms",
          }}
        />
        {peakPct != null && peakPct > pct + 0.5 && (
          // Peak high-water tick — where memory has been, even if it's dropped back.
          <Box
            title={`peak ${gb(peak!)}`}
            sx={{ position: "absolute", top: -2, bottom: -2, left: `calc(${peakPct}% - 1px)`, width: 2, bgcolor: "error.light", opacity: 0.9 }}
          />
        )}
      </Box>
      <Stack direction="row" sx={{ mt: 0.5, minHeight: 16 }}>
        <Typography variant="caption" color="text.disabled">
          {hint}
        </Typography>
        {peak != null && (
          <Typography variant="caption" color="text.disabled" sx={{ ml: "auto", fontVariantNumeric: "tabular-nums" }}>
            peak {gb(peak)}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
