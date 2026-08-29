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
import Checkbox from "@mui/material/Checkbox";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  DEFAULT_BASEMAP_COLORS,
  THEME_OVERRIDE_KEYS,
  type ControlState,
} from "@photonsurge/shared/control";
import { BROADCAST_THEMES, DEFAULT_THEME, THEME_OPTIONS, getBroadcastTheme } from "../../broadcast/config";
import { fetchSceneState } from "../../../lib/scenes";
import { useSceneDraft } from "./SceneDraft";
import BasemapColorPicker from "../../BasemapColorPicker";
import ColorField from "../ColorField";
import ThemePreview from "./ThemePreview";
import { generateScenePalette, isHexColour } from "./theme-palette";

type ThemeKey = (typeof THEME_OVERRIDE_KEYS)[number];
type FieldGroup = "identity" | "interface" | "surfaces" | "map" | "minimap" | "advanced";
type ThemeField = { key: ThemeKey; label: string; color?: boolean; group: FieldGroup };

const FIELDS: ThemeField[] = [
  { key: "name", label: "Brand name", group: "identity" },
  { key: "tagline", label: "Tagline", group: "identity" },
  { key: "strapline", label: "Strapline", group: "identity" },
  { key: "tickerTitle", label: "Ticker title", group: "identity" },
  { key: "meterTitle", label: "Meter title", group: "identity" },
  { key: "accent", label: "UI highlight colour", color: true, group: "interface" },
  { key: "titleColor", label: "Panel title colour", color: true, group: "interface" },
  { key: "textColor", label: "Body text colour", color: true, group: "interface" },
  { key: "mutedColor", label: "Muted text colour", color: true, group: "interface" },
  { key: "dimColor", label: "Dim text colour", color: true, group: "interface" },
  { key: "liveColor", label: "LIVE badge colour", color: true, group: "interface" },
  { key: "tickerText", label: "Ticker text colour", color: true, group: "interface" },
  { key: "godsPanelTopColor", label: "G.O.D.S. panel top", color: true, group: "surfaces" },
  { key: "godsPanelMidColor", label: "G.O.D.S. panel middle", color: true, group: "surfaces" },
  { key: "godsPanelBottomColor", label: "G.O.D.S. panel bottom", color: true, group: "surfaces" },
  { key: "godsBorderColor", label: "G.O.D.S. panel edge", color: true, group: "surfaces" },
  { key: "tileColor", label: "Inset tile colour", color: true, group: "surfaces" },
  { key: "tileBorderColor", label: "Inset tile edge", color: true, group: "surfaces" },
  { key: "mapHighlightColor", label: "Map highlight colour", color: true, group: "map" },
  { key: "mapLabelColor", label: "Map label colour", color: true, group: "map" },
  { key: "mapCapitalColor", label: "Capital label colour", color: true, group: "map" },
  { key: "minimapOceanInnerColor", label: "Locator ocean highlight", color: true, group: "minimap" },
  { key: "minimapOceanOuterColor", label: "Locator ocean shadow", color: true, group: "minimap" },
  { key: "minimapLandColor", label: "Locator land colour", color: true, group: "minimap" },
  { key: "minimapLandEdgeColor", label: "Locator coastline colour", color: true, group: "minimap" },
  { key: "minimapGridColor", label: "Locator grid colour", color: true, group: "minimap" },
  { key: "minimapLimbColor", label: "Locator outer edge", color: true, group: "minimap" },
  { key: "minimapAccentColor", label: "Locator reticle colour", color: true, group: "minimap" },
  { key: "tickerBg", label: "Ticker background (CSS)", group: "advanced" },
  { key: "panelBg", label: "Legacy panel background (CSS)", group: "advanced" },
  { key: "panelBorder", label: "Legacy panel border (CSS)", group: "advanced" },
];

const GROUPS: { id: Exclude<FieldGroup, "advanced">; title: string; description: string }[] = [
  { id: "identity", title: "Identity", description: "Names shown in the masthead, ticker, and map furniture." },
  { id: "interface", title: "Interface text & highlights", description: "Shared colours used across headings, labels, readouts, rules, and live indicators." },
  { id: "surfaces", title: "Panels & inset tiles", description: "The G.O.D.S. shells plus the smaller forecast, feed, chart, and monitor boxes inside them." },
  { id: "map", title: "Main map", description: "Vector-basemap fills and the on-air map highlight and place-label colours." },
  { id: "minimap", title: "Locator globe", description: "The small globe embedded into the masthead, separate from the main map." },
];

const MAP_KEYS: ThemeKey[] = ["mapHighlightColor", "mapLabelColor", "mapCapitalColor"];
const LOCATOR_KEYS: ThemeKey[] = [
  "minimapOceanInnerColor",
  "minimapOceanOuterColor",
  "minimapLandColor",
  "minimapLandEdgeColor",
  "minimapGridColor",
  "minimapLimbColor",
  "minimapAccentColor",
];
const TEXT_KEYS: ThemeKey[] = ["titleColor", "textColor", "mutedColor", "dimColor", "tickerText"];

export default function ThemeSettings({ sceneId }: { sceneId: string }) {
  const { stage: patch, epoch } = useSceneDraft();
  const [state, setState] = useState<ControlState | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteHighlight, setPaletteHighlight] = useState<string | null>(null);
  const [paletteBase, setPaletteBase] = useState<string | null>(null);
  const [paletteMap, setPaletteMap] = useState(true);
  const [paletteLocator, setPaletteLocator] = useState(true);
  const [paletteText, setPaletteText] = useState(true);

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
  const highlightSeed = paletteHighlight ?? resolved.accent;
  const baseSeed = paletteBase ?? resolved.godsPanelMidColor;
  const canGenerate = isHexColour(highlightSeed) && isHexColour(baseSeed);
  const generatedPalette = generateScenePalette(highlightSeed, baseSeed);

  const selectedGeneratedOverrides = () => {
    if (!generatedPalette) return {};
    const selected = { ...generatedPalette.themeOverrides };
    if (!paletteMap) MAP_KEYS.forEach((key) => delete selected[key]);
    if (!paletteLocator) LOCATOR_KEYS.forEach((key) => delete selected[key]);
    if (!paletteText) TEXT_KEYS.forEach((key) => delete selected[key]);
    return selected;
  };
  const palettePreviewTheme = getBroadcastTheme(baseId, {
    ...overrides,
    ...selectedGeneratedOverrides(),
  });

  const apply = (over: Partial<ControlState>) => {
    setState({ ...state, ...over });
    patch(sceneId, over);
  };

  // Always send the FULL overrides map: mergeControlState replaces
  // themeOverrides wholesale, so a single-key delta would wipe the rest.
  const setField = (key: (typeof THEME_OVERRIDE_KEYS)[number], value: string) => {
    apply({ themeOverrides: { ...overrides, [key]: value } });
  };

  const generatePalette = () => {
    if (!generatedPalette) return;
    apply({
      themeOverrides: { ...overrides, ...selectedGeneratedOverrides() },
      ...(paletteMap ? { basemapColors: generatedPalette.basemapColors } : {}),
    });
    setPaletteOpen(false);
  };

  const renderField = (f: ThemeField) =>
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
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.25, flexWrap: "wrap", rowGap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Brand / theme
        </Typography>
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
      </Stack>

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
        <Stack spacing={2.25} sx={{ mt: 1 }}>
          {GROUPS.map((group) => (
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
                  <BasemapColorPicker
                    value={state.basemapColors}
                    onChange={(basemapColors) => apply({ basemapColors })}
                  />
                </Box>
              ) : null}
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 1.25 }}>
                {FIELDS.filter((f) => f.group === group.id).map(renderField)}
              </Box>
            </Box>
          ))}
          <Box>
            <Typography variant="subtitle2">Raw CSS overrides</Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              Optional expert controls for legacy rectangular panels and ticker backgrounds.
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 1.25 }}>
              {FIELDS.filter((f) => f.group === "advanced").map(renderField)}
            </Box>
          </Box>
        </Stack>
      </Collapse>

      <Dialog open={paletteOpen} onClose={() => setPaletteOpen(false)} fullWidth maxWidth="lg">
        <DialogTitle>Generate scene palette</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Choose two seed colours, then preview the generated broadcast theme before applying it. Manual controls remain available under Advanced.
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 1.25 }}>
            <ColorField
              label="Palette highlight"
              value={highlightSeed}
              resolved={isHexColour(highlightSeed) ? highlightSeed : resolved.accent}
              onChange={setPaletteHighlight}
            />
            <ColorField
              label="Palette dark base"
              value={baseSeed}
              resolved={isHexColour(baseSeed) ? baseSeed : resolved.godsPanelMidColor}
              onChange={setPaletteBase}
            />
          </Box>
          <Stack direction="row" sx={{ mt: 1, flexWrap: "wrap" }}>
            <FormControlLabel
              control={<Checkbox checked={paletteText} onChange={(e) => setPaletteText(e.target.checked)} />}
              label="Generate text colours"
            />
            <FormControlLabel
              control={<Checkbox checked={paletteMap} onChange={(e) => setPaletteMap(e.target.checked)} />}
              label="Include main map"
            />
            <FormControlLabel
              control={<Checkbox checked={paletteLocator} onChange={(e) => setPaletteLocator(e.target.checked)} />}
              label="Include locator globe"
            />
          </Stack>
          <Box sx={{ mt: 1.5 }}>
            <ThemePreview theme={palettePreviewTheme} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaletteOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!canGenerate} onClick={generatePalette}>
            Apply generated palette
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
