"use client";

/**
 * Per-channel brand editor: a base theme preset (broadcastTheme) plus overrides
 * (themeOverrides) for the identity fields — name, tagline, accent, panel glass,
 * ticker/meter titles. Any field left blank inherits the preset. STAGED as a
 * DELTA patch (useSceneDraft) — the page's Save bar applies it to /watch/:id. A
 * live preview mirrors getBroadcastTheme() so the operator sees the resolved
 * brand as they type, before saving.
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { THEME_OVERRIDE_KEYS, type ControlState, type ThemeOverrides } from "@photonsurge/shared/control";
import {
  BROADCAST_THEMES,
  DEFAULT_THEME,
  THEME_OPTIONS,
  getBroadcastTheme,
} from "../../broadcast/config";
import { fetchSceneState } from "../../../lib/scenes";
import { useSceneDraft } from "./SceneDraft";

const FIELDS: { key: (typeof THEME_OVERRIDE_KEYS)[number]; label: string; color?: boolean; advanced?: boolean }[] = [
  { key: "name", label: "Brand name" },
  { key: "tagline", label: "Tagline" },
  { key: "strapline", label: "Strapline" },
  { key: "accent", label: "Accent colour", color: true },
  { key: "tickerTitle", label: "Ticker title" },
  { key: "meterTitle", label: "Meter title" },
  { key: "panelBg", label: "Panel background (CSS)", advanced: true },
  { key: "panelBorder", label: "Panel border (CSS)", advanced: true },
];

export default function ThemeSettings({ sceneId }: { sceneId: string }) {
  const { stage: patch, epoch } = useSceneDraft();
  const [state, setState] = useState<ControlState | null>(null);

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

  const setField = (key: (typeof THEME_OVERRIDE_KEYS)[number], value: string) => {
    apply({ themeOverrides: { ...overrides, [key]: value } });
  };

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

      {/* Live preview — the resolved brand as /watch will render it. */}
      <Box
        aria-label="Theme preview"
        sx={{ p: 1.5, mb: 1.5, borderRadius: 1, background: resolved.panelBg, border: resolved.panelBorder }}
      >
        <Typography sx={{ color: resolved.accent, fontWeight: 800, letterSpacing: 0.5 }}>
          {resolved.name}
        </Typography>
        <Typography variant="caption" sx={{ color: "#cbd5e1", display: "block" }}>
          {resolved.tagline}
        </Typography>
        {resolved.strapline && (
          <Typography variant="caption" sx={{ color: "#8b95a7", display: "block" }}>
            {resolved.strapline}
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Chip label={resolved.tickerTitle} size="small" sx={{ bgcolor: resolved.accent, color: "#00121c", fontWeight: 700 }} />
          <Chip label={resolved.meterTitle} size="small" variant="outlined" sx={{ borderColor: resolved.accent, color: resolved.accent }} />
        </Stack>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 1.25 }}>
        {FIELDS.map((f) => (
          <Stack key={f.key} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <TextField
              size="small"
              fullWidth
              label={f.label}
              value={overrides[f.key] ?? ""}
              placeholder={basePreset[f.key] ?? ""}
              onChange={(e) => setField(f.key, e.target.value)}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { "aria-label": f.label } }}
            />
            {f.color && (
              <input
                type="color"
                aria-label={`${f.label} picker`}
                value={/^#[0-9a-fA-F]{6}$/.test(overrides.accent ?? "") ? overrides.accent! : resolved.accent}
                onChange={(e) => setField("accent", e.target.value)}
                style={{ width: 32, height: 32, border: "none", background: "none", padding: 0, cursor: "pointer" }}
              />
            )}
          </Stack>
        ))}
      </Box>
    </Paper>
  );
}
