"use client";

/**
 * Director: looks — which map looks each touring kind steps through, and which
 * saved look (slide) each kind airs with. Saving a NEW look snapshots the live
 * map, so it stays on /control's director panel; here the operator picks from
 * the library and deletes stale entries. Every edit stages COMPLETE top-level
 * DirectorConfig fields.
 */
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { SEGMENT_KINDS, type SegmentKind } from "@photonsurge/shared/director";
import {
  INTRO_MAP_TYPES,
  OCEAN_MAP_TYPES,
  QUAKE_MAP_TYPES,
  type GlobalMapType,
} from "@photonsurge/shared/director-rois";
import { KIND_LABEL } from "../../../lib/kind-labels";
import SettingsCard from "./SettingsCard";
import { useSceneDraft } from "./SceneDraft";

export const TOURED_KINDS: { kind: SegmentKind; label: string; catalog: GlobalMapType[] }[] = [
  { kind: "intro", label: "Intro spin (opener)", catalog: INTRO_MAP_TYPES },
  { kind: "global", label: "Global spin", catalog: INTRO_MAP_TYPES },
  { kind: "ocean", label: "Ocean spin", catalog: OCEAN_MAP_TYPES },
  { kind: "quake", label: "Earthquake terrain", catalog: QUAKE_MAP_TYPES },
];

/** "default" in the look picker: the kind's preset look, no saved slide. */
const DEFAULT_LOOK = "";

export default function DirectorLooksSettings() {
  const { sceneId, config: cfg, stageDirector } = useSceneDraft();

  const toured = TOURED_KINDS.filter((t) => cfg.kinds[t.kind]);
  const lookKinds = SEGMENT_KINDS.filter((k) => cfg.kinds[k] && k !== "point" && k !== "ad");

  /** An empty / absent list means "all"; store the explicit selection otherwise. */
  const toggleMapType = (kind: SegmentKind, catalog: GlobalMapType[], id: string, on: boolean) => {
    const current = cfg.mapTypes[kind]?.length ? cfg.mapTypes[kind]! : catalog.map((t) => t.id);
    const next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
    // Never leave a kind with no looks at all — the client would fall back to all anyway.
    if (next.length === 0) return;
    const all = catalog.every((t) => next.includes(t.id));
    stageDirector({ mapTypes: { ...cfg.mapTypes, [kind]: all ? [] : catalog.map((t) => t.id).filter((x) => next.includes(x)) } });
  };

  const pickLook = (kind: SegmentKind, slideId: string) => {
    const slide = (cfg.kindSlides[kind] ?? []).find((s) => s.id === slideId);
    stageDirector({
      kindLooks: { ...cfg.kindLooks, [kind]: slide ? { ...slide.look } : {} },
      overlayOverrides: { ...cfg.overlayOverrides, [kind]: slide ? { ...slide.overlays } : {} },
      activeSlideId: { ...cfg.activeSlideId, [kind]: slide ? slide.id : null },
    });
  };

  const deleteLook = (kind: SegmentKind, slideId: string) => {
    const slides = cfg.kindSlides[kind] ?? [];
    const wasActive = cfg.activeSlideId[kind] === slideId;
    stageDirector({
      kindSlides: { ...cfg.kindSlides, [kind]: slides.filter((s) => s.id !== slideId) },
      ...(wasActive ? { activeSlideId: { ...cfg.activeSlideId, [kind]: null } } : {}),
    });
  };

  return (
    <SettingsCard
      id="director-looks"
      blurb={
        <>
          How each kind of shot looks on air. To save a new look from the live map, use the
          director panel on the <Link href={`/control?scene=${encodeURIComponent(sceneId)}`}>Control page</Link>.
        </>
      }
    >
      {toured.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Map looks a spin steps through
          </Typography>
          {toured.map(({ kind, label, catalog }) => {
            const selected = cfg.mapTypes[kind]?.length ? cfg.mapTypes[kind]! : catalog.map((t) => t.id);
            return (
              <Box key={kind} sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 1 }}>
                  {catalog.map((t) => (
                    <FormControlLabel
                      key={t.id}
                      control={
                        <Checkbox
                          size="small"
                          checked={selected.includes(t.id)}
                          onChange={(e) => toggleMapType(kind, catalog, t.id, e.target.checked)}
                          slotProps={{ input: { "aria-label": `${label}: ${t.title}` } }}
                        />
                      }
                      label={<Typography variant="body2">{t.title}</Typography>}
                    />
                  ))}
                </Box>
              </Box>
            );
          })}
        </>
      )}

      <Typography variant="subtitle2" sx={{ mt: 1, mb: 1 }}>
        Saved look per shot type
      </Typography>
      <Stack spacing={1.25}>
        {lookKinds.map((kind) => {
          const slides = cfg.kindSlides[kind] ?? [];
          const active = cfg.activeSlideId[kind] ?? DEFAULT_LOOK;
          const value = slides.some((s) => s.id === active) ? active : DEFAULT_LOOK;
          return (
            <Stack key={kind} direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <TextField
                select
                size="small"
                label={KIND_LABEL[kind]}
                value={value}
                onChange={(e) => pickLook(kind, e.target.value)}
                sx={{ width: 280 }}
                disabled={slides.length === 0}
                helperText={slides.length === 0 ? "No saved looks yet" : undefined}
              >
                <MenuItem value={DEFAULT_LOOK}>Default look</MenuItem>
                {slides.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
              {value !== DEFAULT_LOOK && (
                <IconButton
                  size="small"
                  aria-label={`Delete saved look ${slides.find((s) => s.id === value)?.name ?? ""} for ${KIND_LABEL[kind]}`}
                  onClick={() => deleteLook(kind, value)}
                >
                  ✕
                </IconButton>
              )}
            </Stack>
          );
        })}
      </Stack>
    </SettingsCard>
  );
}
