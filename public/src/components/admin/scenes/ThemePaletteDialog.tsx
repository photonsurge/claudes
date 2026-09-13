"use client";

/**
 * The palette generator: two seed colours — a highlight and a dark base — become
 * a whole coherent broadcast palette, previewed in real chrome before it is
 * applied. Which parts land is the operator's choice (text, main map, locator
 * globe), and everything stays individually editable afterwards under Advanced.
 *
 * It holds only its own dialog state; applying hands the parent a complete
 * overrides map to stage.
 */
import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ControlState } from "@photonsurge/shared/control";
import { getBroadcastTheme, type BroadcastTheme } from "../../broadcast/config";
import ColorField from "../ColorField";
import ThemePreview from "./ThemePreview";
import { generateScenePalette, isHexColour } from "./theme-palette";
import { LOCATOR_KEYS, MAP_KEYS, TEXT_KEYS, type ThemeKey } from "./theme-fields";

export default function ThemePaletteDialog({
  open,
  onClose,
  baseId,
  overrides,
  resolved,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  baseId: string;
  overrides: Partial<Record<ThemeKey, string>>;
  resolved: BroadcastTheme;
  onApply: (next: {
    themeOverrides: Partial<Record<ThemeKey, string>>;
    basemapColors?: ControlState["basemapColors"];
  }) => void;
}) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [withMap, setWithMap] = useState(true);
  const [withLocator, setWithLocator] = useState(true);
  const [withText, setWithText] = useState(true);

  const highlightSeed = highlight ?? resolved.accent;
  const baseSeed = base ?? resolved.godsPanelMidColor;
  const canGenerate = isHexColour(highlightSeed) && isHexColour(baseSeed);
  const generated = generateScenePalette(highlightSeed, baseSeed);

  /** The generated overrides minus the parts the operator excluded. */
  const selected = (): Partial<Record<ThemeKey, string>> => {
    if (!generated) return {};
    const out = { ...generated.themeOverrides } as Partial<Record<ThemeKey, string>>;
    if (!withMap) MAP_KEYS.forEach((key) => delete out[key]);
    if (!withLocator) LOCATOR_KEYS.forEach((key) => delete out[key]);
    if (!withText) TEXT_KEYS.forEach((key) => delete out[key]);
    return out;
  };

  const previewTheme = getBroadcastTheme(baseId, { ...overrides, ...selected() });

  const apply = () => {
    if (!generated) return;
    onApply({
      themeOverrides: { ...overrides, ...selected() },
      ...(withMap ? { basemapColors: generated.basemapColors } : {}),
    });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Generate scene palette</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Choose two seed colours, then preview the generated broadcast theme before applying it.
          Manual controls remain available under Advanced.
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 1.25 }}>
          <ColorField
            label="Palette highlight"
            value={highlightSeed}
            resolved={isHexColour(highlightSeed) ? highlightSeed : resolved.accent}
            onChange={setHighlight}
          />
          <ColorField
            label="Palette dark base"
            value={baseSeed}
            resolved={isHexColour(baseSeed) ? baseSeed : resolved.godsPanelMidColor}
            onChange={setBase}
          />
        </Box>
        <Stack direction="row" sx={{ mt: 1, flexWrap: "wrap" }}>
          <FormControlLabel
            control={<Checkbox checked={withText} onChange={(e) => setWithText(e.target.checked)} />}
            label="Generate text colours"
          />
          <FormControlLabel
            control={<Checkbox checked={withMap} onChange={(e) => setWithMap(e.target.checked)} />}
            label="Include main map"
          />
          <FormControlLabel
            control={<Checkbox checked={withLocator} onChange={(e) => setWithLocator(e.target.checked)} />}
            label="Include locator globe"
          />
        </Stack>
        <Box sx={{ mt: 1.5 }}>
          <ThemePreview theme={previewTheme} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!canGenerate} onClick={apply}>
          Apply generated palette
        </Button>
      </DialogActions>
    </Dialog>
  );
}
