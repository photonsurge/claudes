"use client";

/**
 * The palettes viewers may pick with `:theme <id>`. Empty = the built-in
 * presets (command / aurora / storm); a channel can list its own instead, each
 * a name over a base preset.
 */
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { BUILT_IN_PALETTES, type ViewerPalette } from "@photonsurge/shared/chat-policy";
import { BROADCAST_THEMES } from "../../broadcast/config";

const PRESETS = Object.keys(BROADCAST_THEMES);
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);

export default function ChatPaletteList({
  palettes,
  onChange,
}: {
  palettes: ViewerPalette[];
  onChange: (next: ViewerPalette[]) => void;
}) {
  if (!palettes.length) {
    return (
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary" component="div">
          Viewers pick from the built-in palettes: {BUILT_IN_PALETTES.map((p) => p.id).join(", ")}.
        </Typography>
        <Button size="small" onClick={() => onChange(BUILT_IN_PALETTES.map((p) => ({ ...p })))}>
          Customise the list
        </Button>
      </Box>
    );
  }
  const update = (i: number, over: Partial<ViewerPalette>) => onChange(palettes.map((p, j) => (j === i ? { ...p, ...over } : p)));
  return (
    <Box sx={{ mb: 1.5 }}>
      {palettes.map((p, i) => (
        <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1 }}>
          <TextField
            size="small"
            label="Name"
            value={p.label}
            onChange={(e) => update(i, { label: e.target.value, id: slug(e.target.value) || p.id })}
            sx={{ width: 180 }}
          />
          <TextField select size="small" label="Based on" value={p.broadcastTheme} onChange={(e) => update(i, { broadcastTheme: e.target.value })} sx={{ width: 150 }}>
            {PRESETS.map((id) => (
              <MenuItem key={id} value={id}>
                {id}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="caption" color="text.secondary">:theme {p.id}</Typography>
          <IconButton size="small" aria-label={`Remove palette ${p.label}`} onClick={() => onChange(palettes.filter((_, j) => j !== i))}>
            ✕
          </IconButton>
        </Box>
      ))}
      <Button size="small" onClick={() => onChange([...palettes, { id: `palette-${palettes.length + 1}`, label: `Palette ${palettes.length + 1}`, broadcastTheme: "command" }])}>
        Add a palette
      </Button>
    </Box>
  );
}
