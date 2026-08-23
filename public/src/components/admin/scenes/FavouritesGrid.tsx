"use client";

/**
 * Compact multi-select checkbox grid for the DirectorSettings catalogs
 * (countries / areas) — the MUI cousin of the retired /control CheckboxGrid.
 * Pure presentation: the parent owns the selected set and staging.
 */
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";

export default function FavouritesGrid({
  items,
  selected,
  onToggle,
}: {
  items: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string, on: boolean) => void;
}) {
  const on = new Set(selected);
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
      {items.map((it) => (
        <FormControlLabel
          key={it.id}
          control={
            <Checkbox
              size="small"
              checked={on.has(it.id)}
              onChange={(e) => onToggle(it.id, e.target.checked)}
              slotProps={{ input: { "aria-label": it.label } }}
              sx={{ p: 0.5 }}
            />
          }
          label={<Typography variant="body2">{it.label}</Typography>}
        />
      ))}
    </Box>
  );
}
