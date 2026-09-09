"use client";

/**
 * Per-channel auto-director CONTENT card: which slide types (segment kinds) the
 * director may air and how often, plus the country / area spotlight favourites
 * and one-click presets. Everything here is DirectorConfig (one doc per scene),
 * staged as delta patches through the page's Save bar (`stageDirector`) — the
 * live pacing controls (Auto/Off, skip, holds, tuning, looks, map types) stay
 * on /control's DirectorPanel.
 *
 * Staging contract: every patch carries COMPLETE top-level fields (the whole
 * `kinds` record, the whole `countries` array…) — the draft bucket and the
 * PATCH route both shallow-merge. Note /control's own director draft snapshots
 * config independently; edits here reach it on its next refetch (pre-existing
 * two-surface behaviour).
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  SEGMENT_KINDS,
  type DirectorConfig,
  type SegmentKind,
} from "@photonsurge/shared/director";
import { COUNTRY_SHOTS } from "@photonsurge/shared/director-countries";
import { REGION_SHOTS } from "@photonsurge/shared/director-regions";
import { DIRECTOR_PRESETS } from "@photonsurge/shared/director-presets";
import { fetchDirectorConfig, mergeConfig } from "../../../lib/director";
import { KIND_LABEL } from "../../../lib/kind-labels";
import { useSceneDraft } from "./SceneDraft";
import FavouritesGrid from "./FavouritesGrid";

/** Airtime-multiplier presets for the per-kind frequency picker. */
const WEIGHT_PRESETS: { w: number; label: string }[] = [
  { w: 0.5, label: "Rarely · ×0.5" },
  { w: 1, label: "Normal · ×1" },
  { w: 2, label: "Often · ×2" },
  { w: 4, label: "Lots · ×4" },
];

export default function DirectorSettings({ sceneId }: { sceneId: string }) {
  const { stageDirector, epoch } = useSceneDraft();
  const [cfg, setCfg] = useState<DirectorConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDirectorConfig(sceneId).then((c) => {
      if (!cancelled) setCfg(c);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId, epoch]);

  const apply = (over: Partial<DirectorConfig>) => {
    if (!cfg) return;
    setCfg(mergeConfig(cfg, over));
    stageDirector(sceneId, over);
  };

  if (!cfg) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading channel…
      </Typography>
    );
  }

  const setKind = (k: SegmentKind, on: boolean) => {
    apply({ kinds: { ...cfg.kinds, [k]: on } });
  };
  const setWeight = (k: SegmentKind, w: number) => {
    apply({ kindWeights: { ...cfg.kindWeights, [k]: w } });
  };
  const toggleIn = (field: "countries" | "regions", id: string, on: boolean) => {
    const next = new Set(cfg[field]);
    if (on) next.add(id);
    else next.delete(id);
    apply({ [field]: [...next] });
  };

  const controlHref = `/control?scene=${encodeURIComponent(sceneId)}`;

  return (
    <Paper sx={{ p: 1.75 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Auto-director content
        </Typography>
        <Chip
          size="small"
          label={cfg.mode === "auto" ? "Auto" : "Off"}
          color={cfg.mode === "auto" ? "success" : "default"}
          variant="outlined"
        />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
        What this channel covers when the director is driving. Start/stop, skip and live
        pacing are on the <Link href={controlHref}>Control page</Link>.
      </Typography>

      {/* One-click content bundles — staged like any hand edit, nothing airs on click. */}
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mb: 1.5 }}>
        {DIRECTOR_PRESETS.map((p) => (
          <Tooltip key={p.id} title={p.description}>
            <Chip size="small" label={p.name} onClick={() => apply(p.patch)} />
          </Tooltip>
        ))}
      </Stack>

      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Which slide types air
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        Tick a type to make it eligible; the frequency biases how often it comes up in
        rotation. Hold times per type live on the Control page.
      </Typography>
      <Box sx={{ display: "grid", gap: 0.25, mb: 1.5 }}>
        {SEGMENT_KINDS.map((k) => {
          const on = !!cfg.kinds[k];
          const weight = cfg.kindWeights?.[k] ?? 1;
          // A non-preset persisted weight still needs an option to sit on, or MUI warns.
          const weightOptions = WEIGHT_PRESETS.some((p) => p.w === weight)
            ? WEIGHT_PRESETS
            : [...WEIGHT_PRESETS, { w: weight, label: `×${weight}` }];
          return (
            <Stack key={k} direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Checkbox
                size="small"
                checked={on}
                onChange={(e) => setKind(k, e.target.checked)}
                slotProps={{ input: { "aria-label": KIND_LABEL[k] } }}
                sx={{ p: 0.5 }}
              />
              <Typography variant="body2" sx={{ flex: 1 }}>
                {KIND_LABEL[k]}
              </Typography>
              {/* The intro is the one-time session opener — never in rotation, so
                  a frequency weight would be meaningless for it. */}
              {on && k !== "intro" && (
                <TextField
                  select
                  size="small"
                  value={weight}
                  onChange={(e) => setWeight(k, Number(e.target.value))}
                  sx={{ width: 130 }}
                  slotProps={{ htmlInput: { "aria-label": `${KIND_LABEL[k]} frequency` } }}
                >
                  {weightOptions.map((p) => (
                    <MenuItem key={p.w} value={p.w}>
                      {p.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Stack>
          );
        })}
      </Box>

      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Country spotlights ({cfg.countries.length} of {COUNTRY_SHOTS.length})
      </Typography>
      {!cfg.kinds.country && (
        <Alert severity="info" sx={{ mb: 1 }}>
          The Countries slide type is off — favourites here won&apos;t air until it&apos;s
          enabled above.
        </Alert>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        All countries can air. Favourites get a 5× selection preference.
      </Typography>
      <FavouritesGrid
        items={COUNTRY_SHOTS.map((c) => ({ id: c.id, label: `${c.flag} ${c.name}` }))}
        selected={cfg.countries}
        onToggle={(id, on) => toggleIn("countries", id, on)}
      />

      <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
        Areas ({cfg.regions.length} of {REGION_SHOTS.length})
      </Typography>
      {!cfg.kinds.region && (
        <Alert severity="info" sx={{ mb: 1 }}>
          The Areas slide type is off — favourites here won&apos;t air until it&apos;s
          enabled above.
        </Alert>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        All areas can air. Favourites get a 5× selection preference.
      </Typography>
      <FavouritesGrid
        items={REGION_SHOTS.map((r) => ({ id: r.id, label: r.name }))}
        selected={cfg.regions}
        onToggle={(id, on) => toggleIn("regions", id, on)}
      />
    </Paper>
  );
}
