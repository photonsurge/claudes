"use client";

/**
 * How long each shot holds, for the kinds this channel airs. The event kinds
 * hold per level instead of one number — earthquakes by magnitude class,
 * storms by severity, volcanoes by status — and only the levels that can air
 * under the channel's pool bar are listed. Every edit stages the COMPLETE hold
 * map it belongs to.
 */
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import {
  DEFAULT_KIND_HOLD_SECONDS,
  DEFAULT_QUAKE_HOLD_SECONDS,
  DEFAULT_STORM_HOLD_SECONDS,
  DEFAULT_VOLCANO_HOLD_SECONDS,
  SEGMENT_KINDS,
  STORM_LEVELS,
  VOLCANO_LEVELS,
  type DirectorConfig,
  type SegmentKind,
} from "@photonsurge/shared/director";
import { QUAKE_MAGNITUDE_BANDS } from "@photonsurge/shared/seismic";
import { KIND_LABEL } from "../../../lib/kind-labels";
import TuningField from "./TuningField";

/** Kinds whose hold comes from a per-level map, not the kind's own number. */
const LEVELLED = new Set<SegmentKind>(["quake", "storm", "volcano"]);
/** The server floors every hold at 3 s (mergeHolds). */
const MIN_HOLD = 3;
const MAX_HOLD = 900;

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 1.5, mb: 1.5 };

export default function DirectorHoldFields({
  cfg,
  stage,
}: {
  cfg: DirectorConfig;
  stage: (patch: Partial<DirectorConfig>) => void;
}) {
  const on = (k: SegmentKind) => !!cfg.kinds[k];
  // `point` is a sandbox kind the director never schedules.
  const plain = SEGMENT_KINDS.filter((k) => on(k) && !LEVELLED.has(k) && k !== "point");
  // A band can air when its (exclusive) top sits above the pool's minimum magnitude.
  const quakeBands = QUAKE_MAGNITUDE_BANDS.filter((b, i) => {
    const upper = i === 0 ? Infinity : QUAKE_MAGNITUDE_BANDS[i - 1].min;
    return upper > cfg.minQuakeMag;
  });
  const stormLevels = STORM_LEVELS.filter((l) => l.rank >= cfg.minAlertSeverity);

  const field = (label: string, value: number, def: number, set: (s: number) => void) => (
    <TuningField key={label} label={label} value={value} defaultValue={def} min={MIN_HOLD} max={MAX_HOLD} unit="s" onChange={set} />
  );

  return (
    <>
      <Box sx={grid}>
        {plain.map((k) =>
          field(KIND_LABEL[k], cfg.kindHoldSeconds[k], DEFAULT_KIND_HOLD_SECONDS[k], (s) =>
            stage({ kindHoldSeconds: { ...cfg.kindHoldSeconds, [k]: s } }),
          ),
        )}
      </Box>

      {on("quake") && (
        <>
          <Typography variant="caption" color="text.secondary">Earthquakes, by magnitude</Typography>
          <Box sx={grid}>
            {quakeBands.map((b) =>
              field(`Quake: ${b.label}`, cfg.quakeHoldSeconds[b.cls], DEFAULT_QUAKE_HOLD_SECONDS[b.cls], (s) =>
                stage({ quakeHoldSeconds: { ...cfg.quakeHoldSeconds, [b.cls]: s } }),
              ),
            )}
          </Box>
        </>
      )}

      {on("storm") && (
        <>
          <Typography variant="caption" color="text.secondary">Severe weather, by severity</Typography>
          <Box sx={grid}>
            {stormLevels.map((l) =>
              field(`Storm: ${l.label}`, cfg.stormHoldSeconds[l.key], DEFAULT_STORM_HOLD_SECONDS[l.key], (s) =>
                stage({ stormHoldSeconds: { ...cfg.stormHoldSeconds, [l.key]: s } }),
              ),
            )}
          </Box>
        </>
      )}

      {on("volcano") && (
        <>
          <Typography variant="caption" color="text.secondary">Volcanoes, by status</Typography>
          <Box sx={grid}>
            {VOLCANO_LEVELS.map((l) =>
              field(`Volcano: ${l.label}`, cfg.volcanoHoldSeconds[l.key], DEFAULT_VOLCANO_HOLD_SECONDS[l.key], (s) =>
                stage({ volcanoHoldSeconds: { ...cfg.volcanoHoldSeconds, [l.key]: s } }),
              ),
            )}
          </Box>
        </>
      )}
    </>
  );
}
