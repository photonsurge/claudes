"use client";

/**
 * The brand editor's advanced half: every overridable theme field, grouped, with
 * the vector-basemap picker folded into the map group and the raw-CSS escape
 * hatches last. A blank field inherits the base preset, which is why each input
 * shows the preset's value as its placeholder.
 */
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { BroadcastTheme } from "../../broadcast/config";
import type { ControlState } from "@photonsurge/shared/control";
import BasemapColorPicker from "../../BasemapColorPicker";
import ColorField from "../ColorField";
import { THEME_FIELDS, THEME_GROUPS, type ThemeField, type ThemeKey } from "./theme-fields";

export default function ThemeFieldGroups({
  overrides,
  basePreset,
  resolved,
  basemapColors,
  onField,
  onBasemapColors,
}: {
  overrides: Partial<Record<ThemeKey, string>>;
  basePreset: BroadcastTheme;
  resolved: BroadcastTheme;
  basemapColors: ControlState["basemapColors"];
  onField: (key: ThemeKey, value: string) => void;
  onBasemapColors: (next: ControlState["basemapColors"]) => void;
}) {
  const renderField = (f: ThemeField) =>
    f.color ? (
      <ColorField
        key={f.key}
        label={f.label}
        value={overrides[f.key] ?? ""}
        placeholder={basePreset[f.key] ?? ""}
        resolved={String(resolved[f.key] ?? "")}
        onChange={(v) => onField(f.key, v)}
      />
    ) : (
      <TextField
        key={f.key}
        size="small"
        fullWidth
        label={f.label}
        value={overrides[f.key] ?? ""}
        placeholder={basePreset[f.key] ?? ""}
        onChange={(e) => onField(f.key, e.target.value)}
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { "aria-label": f.label } }}
      />
    );

  const grid = (fields: ThemeField[]) => (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 1.25 }}>
      {fields.map(renderField)}
    </Box>
  );

  return (
    <Stack spacing={2.25} sx={{ mt: 1 }}>
      {THEME_GROUPS.map((group) => (
        <Box key={group.id} component="section" aria-label={group.title}>
          <Typography variant="subtitle2">{group.title}</Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
            {group.description}
          </Typography>
          {group.id === "map" ? (
            <Box sx={{ mb: 1.25 }}>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                Vector basemap colours
              </Typography>
              <BasemapColorPicker value={basemapColors} onChange={onBasemapColors} />
            </Box>
          ) : null}
          {grid(THEME_FIELDS.filter((f) => f.group === group.id))}
        </Box>
      ))}
      <Box>
        <Typography variant="subtitle2">Raw CSS overrides</Typography>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
          Optional expert controls for legacy rectangular panels and ticker backgrounds.
        </Typography>
        {grid(THEME_FIELDS.filter((f) => f.group === "advanced"))}
      </Box>
    </Stack>
  );
}
