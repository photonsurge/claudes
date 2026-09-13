"use client";

/**
 * Per-channel brand editor: a base theme preset (broadcastTheme) plus overrides
 * (themeOverrides) for the identity fields and the chrome ink tokens — titles,
 * body/muted text, LIVE badge, ticker colours, panel glass. Any field left
 * blank inherits the preset. STAGED as a DELTA patch — the page's Save bar
 * applies it to /watch/:id. The ThemePreview renders REAL broadcast components
 * from the draft, so the operator sees the exact on-air look before saving.
 *
 * The field grid lives in ThemeFieldGroups and the generator in
 * ThemePaletteDialog; this file is the preset, the preview and the resets.
 */
import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import {
  DEFAULT_BASEMAP_COLORS,
  THEME_OVERRIDE_KEYS,
  type ControlState,
} from "@photonsurge/shared/control";
import { BROADCAST_THEMES, DEFAULT_THEME, THEME_OPTIONS, getBroadcastTheme } from "../../broadcast/config";
import SettingsCard from "./SettingsCard";
import ThemePreview from "./ThemePreview";
import ThemeFieldGroups from "./ThemeFieldGroups";
import ThemePaletteDialog from "./ThemePaletteDialog";
import { type ThemeKey } from "./theme-fields";
import { useSceneDraft } from "./SceneDraft";

export default function ThemeSettings() {
  const { state, stage } = useSceneDraft();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const baseId = state.broadcastTheme;
  const overrides = state.themeOverrides ?? {};
  const basePreset = BROADCAST_THEMES[baseId] ?? DEFAULT_THEME;
  const resolved = getBroadcastTheme(baseId, overrides);
  const anyOverride = THEME_OVERRIDE_KEYS.some((k) => (overrides[k] ?? "") !== "");

  const apply = (over: Partial<ControlState>) => stage(over);

  // Always send the FULL overrides map: mergeControlState replaces
  // themeOverrides wholesale, so a single-key delta would wipe the rest.
  const setField = (key: ThemeKey, value: string) =>
    apply({ themeOverrides: { ...overrides, [key]: value } });

  return (
    <SettingsCard
      id="theme"
      actions={
        <>
          <Button size="small" disabled={!anyOverride} onClick={() => apply({ themeOverrides: {} })}>
            Reset overrides
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() =>
              apply({
                broadcastTheme: "command",
                themeOverrides: {},
                basemapColors: { ...DEFAULT_BASEMAP_COLORS },
              })
            }
          >
            Reset to default theme
          </Button>
        </>
      }
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mb: 1.5, flexWrap: "wrap" }}>
        <TextField
          select
          size="small"
          label="Base preset"
          value={THEME_OPTIONS.some((t) => t.id === baseId) ? baseId : ""}
          onChange={(e) => apply({ broadcastTheme: e.target.value })}
          sx={{ minWidth: 180 }}
          slotProps={{ htmlInput: { "aria-label": "Base preset" } }}
        >
          {THEME_OPTIONS.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.label}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" onClick={() => setPaletteOpen(true)}>
          Generate palette…
        </Button>
      </Stack>

      {/* Real /watch chrome, driven by the DRAFT theme — see it before Save. */}
      <Box sx={{ mb: 1.75 }}>
        <ThemePreview theme={resolved} />
      </Box>

      <Button size="small" sx={{ mt: 1.25 }} onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? "Hide advanced theme controls" : "Advanced theme controls…"}
      </Button>
      <Collapse in={showAdvanced}>
        <ThemeFieldGroups
          overrides={overrides}
          basePreset={basePreset}
          resolved={resolved}
          basemapColors={state.basemapColors}
          onField={setField}
          onBasemapColors={(basemapColors) => apply({ basemapColors })}
        />
      </Collapse>

      <ThemePaletteDialog
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        baseId={baseId}
        overrides={overrides}
        resolved={resolved}
        onApply={(next) => apply(next as Partial<ControlState>)}
      />
    </SettingsCard>
  );
}
