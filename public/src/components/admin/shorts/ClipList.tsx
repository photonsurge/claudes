"use client";

/**
 * The selected script's clips as a plain ordered list (the timeline editor is
 * a later package): index, label, target, start + duration, and whichever of
 * `maxStops` / `tourDwellMs` / `leadSlide` the template set. When the last
 * preview play skipped a clip, its reason shows against it.
 */
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { clipStarts, scriptDurationMs, type ShortScript, type ShortScriptPlay } from "@photonsurge/shared/short-script";
import { formatDuration, scopeLabel } from "../../../lib/shorts";
import { font, surface } from "../../../theme/tokens";

interface Props {
  script: ShortScript;
  /** The script's latest play on the preview scene, if any. */
  play?: ShortScriptPlay;
}

export default function ClipList({ script, play }: Props) {
  const starts = clipStarts(script.clips);
  const skipped = new Map((play?.skipped ?? []).map((s) => [s.id, s.reason]));

  return (
    <Paper sx={{ p: 1.75 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
        <Typography variant="h2" component="h2" sx={{ fontSize: 18 }}>
          {script.title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {scopeLabel(script.scope)} · {script.clips.length} clip(s) · {formatDuration(scriptDurationMs(script.clips))} · {script.status}
        </Typography>
      </Stack>

      <Box component="ol" sx={{ listStyle: "none", m: 0, mt: 1.5, p: 0 }}>
        {script.clips.map((c, i) => {
          const reason = skipped.get(c.id);
          return (
            <Box
              component="li"
              key={c.id}
              sx={{
                display: "flex",
                gap: 1.25,
                alignItems: "flex-start",
                p: 1,
                mt: i ? 0.75 : 0,
                borderRadius: 1,
                border: "1px solid",
                borderColor: reason ? "warning.main" : "divider",
                bgcolor: surface.sunken,
                opacity: reason ? 0.75 : 1,
              }}
            >
              <Typography component="span" sx={{ ...mono, color: "text.disabled", minWidth: 22 }}>
                {i + 1}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {c.label.icon ? `${c.label.icon} ` : ""}
                  {c.label.title}
                </Typography>
                {c.label.subtitle && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {c.label.subtitle}
                  </Typography>
                )}
                <Typography component="code" variant="caption" sx={{ ...mono, color: "text.disabled", display: "block" }}>
                  {c.target}
                </Typography>
                <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mt: 0.5 }}>
                  {typeof c.maxStops === "number" && <Chip size="small" variant="outlined" label={`max stops ${c.maxStops}`} />}
                  {typeof c.tourDwellMs === "number" && (
                    <Chip size="small" variant="outlined" label={`dwell ${formatDuration(c.tourDwellMs)}/stop`} />
                  )}
                  {c.leadSlide && <Chip size="small" variant="outlined" label={`leads with ${c.leadSlide}`} />}
                  {c.roundupDepth && <Chip size="small" variant="outlined" label={`round-up: ${c.roundupDepth}`} />}
                </Stack>
                {reason && (
                  <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 0.5 }}>
                    Skipped in the last preview: {reason}
                  </Typography>
                )}
              </Box>
              <Box sx={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <Typography component="div" variant="body2" sx={mono}>
                  {formatDuration(c.durationMs)}
                </Typography>
                <Typography component="div" variant="caption" sx={{ ...mono, color: "text.disabled" }}>
                  @ {formatDuration(starts[i])}
                </Typography>
              </Box>
            </Box>
          );
        })}
        {!script.clips.length && (
          <Typography component="li" variant="body2" color="text.disabled">
            This script has no clips.
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

const mono = { fontFamily: font.mono, fontVariantNumeric: "tabular-nums" } as const;
