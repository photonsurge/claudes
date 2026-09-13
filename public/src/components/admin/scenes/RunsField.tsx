"use client";

/**
 * RUNS THROUGH — the primary rotation control for both on-air decks, shared by
 * the bottom-left deck card and the WORLD REPORT card.
 *
 * A "run" is the slide's content shown once, end to end: a full top→bottom
 * scroll of a card body on the left, one lap of the ACTIVE FEED marquee on the
 * right. The deck turns the page when the run count is reached, so the viewer is
 * never cut off mid-scroll and never left staring at a slide that finished
 * showing itself ten seconds ago. The dwell beneath this is only a floor.
 */
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

export default function RunsField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  /** Visible + accessible name — must be unique per page (both deck cards render together). */
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (runs: number) => void;
}) {
  const options = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <Box sx={{ mb: 1.5, maxWidth: 380 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={value}
        aria-label={label}
        onChange={(_, v) => {
          if (typeof v === "number") onChange(v);
        }}
        sx={{ mt: 0.5 }}
      >
        {options.map((n) => (
          <ToggleButton key={n} value={n} aria-label={`${label} ${n}`} sx={{ px: 2 }}>
            {n}×
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {hint}
      </Typography>
    </Box>
  );
}
