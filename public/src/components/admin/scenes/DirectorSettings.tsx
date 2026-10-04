"use client";

/**
 * Per-channel auto-director CONTENT card: which slide types (segment kinds) the
 * director may air and how often, plus the country / area spotlight favourites
 * and one-click presets. Everything here is DirectorConfig (one doc per scene),
 * staged through the page's Save bar (`stageDirector`) — the live pacing
 * controls (Auto/Off, skip, holds, tuning, looks, map types) stay on /control's
 * DirectorPanel.
 *
 * Staging contract: every patch carries COMPLETE top-level fields (the whole
 * `kinds` record, the whole `countries` array…) — the draft bucket and the
 * PATCH route both shallow-merge. Note /control's own director draft snapshots
 * config independently; edits here reach it on its next refetch (pre-existing
 * two-surface behaviour).
 */
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { type DirectorConfig, type SegmentKind } from "@photonsurge/shared/director";
import { COUNTRY_SHOTS } from "@photonsurge/shared/director-countries";
import { REGION_SHOTS } from "@photonsurge/shared/director-regions";
import { DIRECTOR_PRESETS } from "@photonsurge/shared/director-presets";
import SettingsCard from "./SettingsCard";
import DirectorKindList from "./DirectorKindList";
import FavouritesGrid from "./FavouritesGrid";
import DirectorModeChip from "./DirectorModeChip";
import { useSceneDraft } from "./SceneDraft";

export default function DirectorSettings() {
  const { sceneId, config: cfg, stageDirector } = useSceneDraft();

  const apply = (over: Partial<DirectorConfig>) => stageDirector(over);

  const toggleIn = (field: "countries" | "regions", id: string, on: boolean) => {
    const next = new Set(cfg[field]);
    if (on) next.add(id);
    else next.delete(id);
    apply({ [field]: [...next] });
  };

  const controlHref = `/control?scene=${encodeURIComponent(sceneId)}`;

  return (
    <SettingsCard
      id="director"
      actions={<DirectorModeChip sceneId={sceneId} mode={cfg.mode} />}
      blurb={
        <>
          What this channel covers when the director is driving. Start/stop, skip and live
          pacing are on the <Link href={controlHref}>Control page</Link>.
        </>
      }
    >
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
      <DirectorKindList
        kinds={cfg.kinds}
        weights={cfg.kindWeights}
        onKind={(k: SegmentKind, on) => apply({ kinds: { ...cfg.kinds, [k]: on } })}
        onWeight={(k: SegmentKind, w) => apply({ kindWeights: { ...cfg.kindWeights, [k]: w } })}
      />

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
    </SettingsCard>
  );
}
