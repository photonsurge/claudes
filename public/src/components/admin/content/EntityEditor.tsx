"use client";

/**
 * Schema-driven text form — renders one labelled input/textarea per editable
 * field from an entity's edit schema. Purely controlled: the parent owns the
 * values and decides what becomes an override. `dirty` fields (differing from
 * the base) get a subtle marker so the operator sees what they've changed.
 */
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { EditFieldSpec } from "@photonsurge/shared/admin-content/schema";

export default function EntityEditor({
  fields,
  values,
  baseText,
  onChange,
}: {
  fields: EditFieldSpec[];
  values: Record<string, string>;
  baseText: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
}) {
  return (
    <Stack spacing={1.5}>
      {fields.map((f) => {
        const value = values[f.field] ?? "";
        const overridden = value.trim() !== "" && value.trim() !== (baseText[f.field] ?? "").trim();
        return (
          <Box key={f.field} component="label" sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Typography variant="caption" color="text.secondary">
                {f.label}
              </Typography>
              {overridden ? (
                <Typography variant="overline" color="warning.main" sx={{ fontSize: 10, letterSpacing: 0.5 }}>
                  ● EDITED
                </Typography>
              ) : null}
            </Stack>
            <TextField
              value={value}
              onChange={(e) => onChange(f.field, e.target.value)}
              fullWidth
              helperText={f.hint}
              {...(f.type === "textarea" ? { multiline: true, minRows: 3 } : {})}
            />
          </Box>
        );
      })}
    </Stack>
  );
}
