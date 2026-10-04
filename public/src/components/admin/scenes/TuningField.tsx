"use client";

/**
 * One numeric director setting: a typeable field with its unit, the channel
 * default as helper text, and the field's bounds. It commits on blur / Enter
 * (half-typed numbers never reach the draft), clamps to [min, max], rounds
 * counts, and puts back the current value when the input isn't a number.
 */
import { useEffect, useState } from "react";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";

export default function TuningField({
  label,
  value,
  defaultValue,
  min,
  max,
  integer = false,
  unit,
  onChange,
}: {
  /** Visible + accessible name; unique per page. */
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  integer?: boolean;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, integer ? Math.round(n) : n));
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <TextField
      size="small"
      label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      helperText={`default ${defaultValue}${unit ? ` ${unit}` : ""} · ${min}–${max}`}
      sx={{ width: 200 }}
      slotProps={{
        input: unit ? { endAdornment: <InputAdornment position="end">{unit}</InputAdornment> } : undefined,
        htmlInput: { inputMode: integer ? "numeric" : "decimal" },
      }}
    />
  );
}
