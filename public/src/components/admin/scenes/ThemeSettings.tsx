"use client";

/**
 * Per-channel brand editor: a base theme preset (broadcastTheme) plus overrides
 * (themeOverrides) for the identity fields and the chrome ink tokens — titles,
 * body/muted text, LIVE badge, ticker colours, panel glass. Any field left
 * blank inherits the preset. STAGED as a DELTA patch (useSceneDraft) — the
 * page's Save bar applies it to /watch/:id. The ThemePreview at the top renders
 * REAL broadcast components from the draft, so the operator sees the exact
 * on-air look before saving.
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { THEME_OVERRIDE_KEYS, type ControlState } from "@photonsurge/shared/control";
import { BROADCAST_THEMES, DEFAULT_THEME, THEME_OPTIONS, getBroadcastTheme } from "../../broadcast/config";
import { fetchSceneState } from "../../../lib/scenes";
import { useSceneDraft } from "./SceneDraft";
import ColorField from "../ColorField";
import ThemePreview from "./ThemePreview";

const FIELDS: { key: (typeof THEME_OVERRIDE_KEYS)[number]; label: string; color?: boolean; advanced?: boolean }[] = [
  { key: "name", label: "Brand name" },
  { key: "tagline", label: "Tagline" },
  { key: "strapline", label: "Strapline" },
  { key: "tickerTitle", label: "Ticker title" },
  { key: "meterTitle", label: "Meter title" },
  { key: "accent", label: "Accent colour", color: true },
  { key: "titleColor", label: "Panel title colour", color: true },
  { key: "textColor", label: "Body text colour", color: true },
  { key: "mutedColor", label: "Muted text colour", color: true },
  { key: "liveColor", label: "LIVE badge colour", color: true },
  { key: "tickerText", label: "Ticker text colour", color: true },
  { key: "dimColor", label: "Dim text colour", color: true, advanced: true },
  { key: "godsPanelTopColor", label: "G.O.D.S. panel top", color: true, advanced: true },
  { key: "godsPanelMidColor", label: "G.O.D.S. panel middle", color: true, advanced: true },
  { key: "godsPanelBottomColor", label: "G.O.D.S. panel bottom", color: true, advanced: true },
  { key: "godsBorderColor", label: "G.O.D.S. border colour", color: true, advanced: true },
  { key: "minimapOceanInnerColor", label: "Minimap ocean highlight", color: true, advanced: true },
  { key: "minimapOceanOuterColor", label: "Minimap ocean shadow", color: true, advanced: true },
  { key: "minimapLandColor", label: "Minimap land colour", color: true, advanced: true },
  { key: "minimapLandEdgeColor", label: "Minimap coastline colour", color: true, advanced: true },
  { key: "minimapGridColor", label: "Minimap grid colour", color: true, advanced: true },
  { key: "minimapLimbColor", label: "Minimap outer edge", color: true, advanced: true },
  { key: "minimapAccentColor", label: "Minimap reticle colour", color: true, advanced: true },
  { key: "tickerBg", label: "Ticker background (CSS)", advanced: true },
  { key: "panelBg", label: "Panel background (CSS)", advanced: true },
  { key: "panelBorder", label: "Panel border (CSS)", advanced: true },
];

export default function ThemeSettings({ sceneId }: { sceneId: string }) {
  const { stage: patch, epoch } = useSceneDraft();
  const [state, setState] = useState<ControlState | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSceneState(sceneId).then(({ state: s }) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId, epoch]);

  if (!state) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading channel…
      </Typography>
    );
  }

  const baseId = state.broadcastTheme;
  const overrides = state.themeOverrides ?? {};
  const basePreset = BROADCAST_THEMES[baseId] ?? DEFAULT_THEME;
  const resolved = getBroadcastTheme(baseId, overrides);
  const anyOverride = THEME_OVERRIDE_KEYS.some((k) => (overrides[k] ?? "") !== "");

  const apply = (over: Partial<ControlState>) => {
    setState({ ...state, ...over });
    patch(sceneId, over);
  };

  // Always send the FULL overrides map: mergeControlState replaces
  // themeOverrides wholesale, so a single-key delta would wipe the rest.
  const setField = (key: (typeof THEME_OVERRIDE_KEYS)[number], value: string) => {
    apply({ themeOverrides: { ...overrides, [key]: value } });
  };

  const renderField = (f: (typeof FIELDS)[number]) =>
    f.color ? (
      <ColorField
        key={f.key}
        label={f.label}
        value={overrides[f.key] ?? ""}
        placeholder={basePreset[f.key] ?? ""}
        resolved={String(resolved[f.key] ?? "")}
        onChange={(v) => setField(f.key, v)}
      />
    ) : (
      <TextField
        key={f.key}
        size="small"
        fullWidth
        label={f.label}
        value={overrides[f.key] ?? ""}
        placeholder={basePreset[f.key] ?? ""}
        onChange={(e) => setField(f.key, e.target.value)}
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { "aria-label": f.label } }}
      />
    );

  return (
    <Paper sx={{ p: 1.75 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.25 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Brand / theme
        </Typography>
        <Button size="small" disabled={!anyOverride} onClick={() => apply({ themeOverrides: {} })}>
          Reset overrides
        </Button>
      </Stack>

      <TextField
        select
        size="small"
        label="Base preset"
        value={THEME_OPTIONS.some((t) => t.id === baseId) ? baseId : ""}
        onChange={(e) => apply({ broadcastTheme: e.target.value })}
        sx={{ mb: 1.5, minWidth: 180 }}
        slotProps={{ htmlInput: { "aria-label": "Base preset" } }}
      >
        {THEME_OPTIONS.map((t) => (
          <MenuItem key={t.id} value={t.id}>
            {t.label}
          </MenuItem>
        ))}
      </TextField>

      {/* Real /watch chrome, driven by the DRAFT theme — see it before Save. */}
      <Box sx={{ mb: 1.75 }}>
        <ThemePreview theme={resolved} />
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 1.25 }}>
        {FIELDS.filter((f) => !f.advanced).map(renderField)}
      </Box>

      <Button size="small" sx={{ mt: 1.25 }} onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? "Hide advanced" : "Advanced…"}
      </Button>
      <Collapse in={showAdvanced}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 1.25,
            mt: 1,
          }}
        >
          {FIELDS.filter((f) => f.advanced).map(renderField)}
        </Box>
      </Collapse>
    </Paper>
  );
}
