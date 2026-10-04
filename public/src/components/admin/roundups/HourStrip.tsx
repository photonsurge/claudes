"use client";

/**
 * HourStrip — 24 hour toggles (00–23) for one round-up row. Pure and
 * controlled: the card owns the draft and runs the toggle through
 * `normalizeHours`, this only draws it and reports which hour was clicked.
 */
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import { accent, font, stroke, surface } from "../../../theme/tokens";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
export const pad2 = (h: number): string => String(h).padStart(2, "0");

export default function HourStrip({
  hours,
  label,
  onToggle,
  dimmed = false,
}: {
  hours: readonly number[];
  /** Row name, for the accessible name of each toggle. */
  label: string;
  onToggle: (hour: number) => void;
  /** The row is switched off: still editable, drawn quieter. */
  dimmed?: boolean;
}) {
  return (
    <Box
      role="group"
      aria-label={`${label} hours`}
      sx={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 0.5, opacity: dimmed ? 0.55 : 1 }}
    >
      {HOURS.map((h) => {
        const on = hours.includes(h);
        return (
          <ButtonBase
            key={h}
            aria-pressed={on}
            aria-label={`${label} ${pad2(h)}:00`}
            onClick={() => onToggle(h)}
            sx={{
              py: 0.5,
              borderRadius: 0.75,
              border: "1px solid",
              borderColor: on ? accent.main : stroke.line,
              bgcolor: on ? accent.main : surface.raised,
              color: on ? accent.contrastText : "text.secondary",
              fontFamily: font.mono,
              fontSize: 12,
              fontWeight: on ? 700 : 400,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {pad2(h)}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
