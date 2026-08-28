"use client";

/**
 * Rotation-dwell control shared by the deck editors: a slider over the sensible
 * broadcast range plus a typeable seconds field for an exact override. The text
 * field commits on blur/Enter (so half-typed values never clobber the draft) and
 * accepts values beyond the slider range — the slider just pins at its end.
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

/** Seconds label for a ms value ("6", "7.5"). */
function secs(ms: number): string {
  const s = ms / 1000;
  return String(Number.isInteger(s) ? s : Math.round(s * 10) / 10);
}

export default function DwellField({
  label,
  valueMs,
  defaultMs,
  minMs,
  maxMs,
  onChange,
}: {
  /** Visible + accessible name — must be unique per page (both deck cards render together). */
  label: string;
  valueMs: number;
  /** The channel default, marked on the slider track. */
  defaultMs: number;
  minMs: number;
  maxMs: number;
  /** Called with the new dwell in ms (always positive). */
  onChange: (ms: number) => void;
}) {
  // Local draft so typing doesn't commit per keystroke; re-synced whenever the
  // committed value changes (slider drag, Discard refetch).
  const [draft, setDraft] = useState(secs(valueMs));
  useEffect(() => setDraft(secs(valueMs)), [valueMs]);

  const commit = () => {
    const s = Number(draft);
    if (Number.isFinite(s) && s > 0) onChange(Math.round(s * 1000));
    else setDraft(secs(valueMs));
  };

  return (
    <Box sx={{ mb: 1.5, maxWidth: 380 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Slider
          size="small"
          aria-label={label}
          value={Math.min(Math.max(valueMs, minMs), maxMs)}
          min={minMs}
          max={maxMs}
          step={1000}
          marks={[{ value: defaultMs, label: `${secs(defaultMs)}s` }]}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => `${secs(v)}s`}
          onChange={(_, v) => onChange(v as number)}
          sx={{ flex: 1, mx: 1 }}
        />
        <TextField
          size="small"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          sx={{ width: 92 }}
          slotProps={{
            input: { endAdornment: <InputAdornment position="end">s</InputAdornment> },
            htmlInput: { "aria-label": `${label} seconds`, inputMode: "decimal" },
          }}
        />
      </Stack>
    </Box>
  );
}
