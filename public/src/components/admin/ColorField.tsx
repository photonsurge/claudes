"use client";

/**
 * Admin colour field: a text input accepting any CSS colour string, with a
 * swatch that opens the native spectrum picker and a ✕ that clears back to
 * "inherit" (the empty string — resolve-time falls through to the preset, so
 * the clear button is the only way back once a colour is set: a colour input
 * can never emit ""). The preset's value ghosts through as the placeholder.
 */
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export default function ColorField({
  label,
  value,
  placeholder,
  resolved,
  onChange,
}: {
  label: string;
  /** The override value; "" / undefined = inherit the preset. */
  value: string | undefined;
  /** The preset's value, ghosted as the input placeholder. */
  placeholder?: string;
  /** The colour actually in effect (override if set, else preset) — paints the swatch. */
  resolved: string;
  onChange: (value: string) => void;
}) {
  const overridden = (value ?? "") !== "";
  // The native picker only speaks 6-digit hex; fall back through the resolved
  // colour so opening it starts near the colour on screen.
  const pickerValue = HEX6.test(value ?? "") ? value! : HEX6.test(resolved) ? resolved : "#000000";

  return (
    <TextField
      size="small"
      fullWidth
      label={label}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      slotProps={{
        inputLabel: { shrink: true },
        htmlInput: { "aria-label": label },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Box
                sx={{
                  position: "relative",
                  width: 22,
                  height: 22,
                  borderRadius: 0.75,
                  border: 1,
                  borderColor: "divider",
                  background: resolved,
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                {/* Invisible native input stretched over the swatch: clicking it
                    opens the browser's full spectrum picker. */}
                <input
                  type="color"
                  aria-label={`${label} picker`}
                  value={pickerValue}
                  onChange={(e) => onChange(e.target.value)}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    opacity: 0,
                    padding: 0,
                    border: "none",
                    cursor: "pointer",
                  }}
                />
              </Box>
            </InputAdornment>
          ),
          endAdornment: overridden ? (
            <InputAdornment position="end">
              <IconButton
                size="small"
                aria-label={`Clear ${label}`}
                onClick={() => onChange("")}
                sx={{ p: 0.25, fontSize: 14 }}
              >
                ✕
              </IconButton>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
}
