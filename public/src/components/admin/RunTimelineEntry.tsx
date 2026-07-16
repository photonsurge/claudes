"use client";

/**
 * One cut on the /admin/runs/:id timeline: when it aired, what kind of shot,
 * which subject (event / country / alert / globe view), how long it really
 * held vs. the plan, and the sub-views (round-up tour stops) inside the shot.
 * Click toggles the raw detail rows (severity, depth, camera…).
 */
import Link from "next/link";
import { useState } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { fmtDuration, kindColor, type AirEntry } from "../../lib/airlog";
import { font } from "../../theme/tokens";

const timeOf = (iso: string): string => new Date(iso).toISOString().slice(11, 19);

/** DESIGN_BIBLE §3: air times, holds and coordinates are readings. */
const reading = { fontFamily: font.mono, fontVariantNumeric: "tabular-nums" } as const;

/** The subject part of "kind:subject" ids; storm ids link to the alert page. */
function subjectOf(e: AirEntry): { label: string; href?: string } {
  const label = e.segmentId.includes(":") ? e.segmentId.slice(e.segmentId.indexOf(":") + 1) : e.segmentId;
  if (e.kind === "storm") return { label, href: `/admin/alerts/${encodeURIComponent(label)}` };
  return { label };
}

export default function RunTimelineEntry({ entry, isLast }: { entry: AirEntry; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const color = kindColor(entry.kind);
  const subject = subjectOf(entry);
  const cutShort = entry.endReason === "skipped";
  const onAirNow = !entry.endedAt && !entry.endReason;

  return (
    <Stack direction="row" spacing={1.75}>
      {/* Rail: air time, kind-coloured dot, connector down to the next cut. */}
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", width: 74, flexShrink: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ ...reading, fontSize: 11 }}>
          {timeOf(entry.startedAt)}
        </Typography>
        {/* The dot's colour is lib/airlog's shared per-kind scale — the same
            data the kind chips above the timeline read. */}
        <Box sx={{ width: 11, height: 11, borderRadius: "50%", bgcolor: color, mt: 0.5, flexShrink: 0 }} />
        {!isLast && <Box sx={{ width: 2, flex: 1, bgcolor: "divider", mt: 0.5 }} />}
      </Box>

      <Paper
        sx={{
          flex: 1,
          minWidth: 0,
          mb: 1.75,
          px: 1.75,
          py: 1.25,
          // The one cut still on air is the one worth spotting from across the
          // room, so it takes the alarm edge.
          borderColor: onAirNow ? "error.main" : "divider",
          cursor: entry.details?.length ? "pointer" : "default",
        }}
        onClick={() => entry.details?.length && setOpen(!open)}
      >
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Chip label={`#${entry.seq} ${entry.kind}`} sx={{ color, borderColor: `${color}55` }} />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {entry.icon ? `${entry.icon} ` : ""}
            {entry.title}
          </Typography>
          {entry.breaking && (
            <Chip title="Aired via the breaking-news priority tier" label="⚡ breaking" color="warning" />
          )}
          {entry.timesShown > 1 && (
            <Chip title="Nth airing of this segment in the session" label={`×${entry.timesShown}`} />
          )}
          {onAirNow && <Chip label="● on air" color="error" />}
        </Stack>

        {entry.subtitle && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.375 }}>
            {entry.subtitle}
          </Typography>
        )}

        <Stack direction="row" spacing={1.75} useFlexGap sx={{ mt: 0.75, flexWrap: "wrap" }}>
          <Typography variant="caption" color="text.disabled" sx={reading}>
            {entry.actualMs != null ? fmtDuration(entry.actualMs) : "…"} of {fmtDuration(entry.holdMs)}
            {cutShort && (
              <Box component="span" sx={{ color: "error.main" }}>
                {" "}
                · skipped early
              </Box>
            )}
          </Typography>
          <Typography variant="caption" color="text.disabled" sx={reading}>
            @ {entry.center[1].toFixed(1)}, {entry.center[0].toFixed(1)} · z{entry.zoom.toFixed(1)}
          </Typography>
          <Typography variant="caption" color="text.disabled" sx={reading}>
            {subject.href ? (
              <MuiLink component={Link} href={subject.href} onClick={(ev: React.MouseEvent) => ev.stopPropagation()}>
                {subject.label}
              </MuiLink>
            ) : (
              subject.label
            )}
          </Typography>
          {entry.adId && (
            <Typography variant="caption" color="text.disabled" sx={reading}>
              ad {entry.adId}
            </Typography>
          )}
        </Stack>

        {/* Sub-views: the camera stops this shot toured through, in order. */}
        {!!entry.stops?.length && (
          <Box sx={{ mt: 1, borderLeft: 2, borderColor: "divider", pl: 1.25 }}>
            {entry.stops.map((s, i) => (
              <Typography key={i} variant="caption" color="text.secondary" component="div" sx={{ py: 0.25 }}>
                ↳ {s.label}
                {s.subtitle ? <Box component="span" sx={{ color: "text.disabled" }}> · {s.subtitle}</Box> : null}
                <Box component="span" sx={{ ...reading, color: "text.disabled", opacity: 0.7 }}>
                  {" "}
                  ({s.lat.toFixed(1)}, {s.lng.toFixed(1)})
                </Box>
              </Typography>
            ))}
          </Box>
        )}

        {open && !!entry.details?.length && (
          <Box component="table" sx={{ mt: 1, fontSize: 12, borderCollapse: "collapse" }}>
            <tbody>
              {entry.details.map((d, i) => (
                <tr key={i}>
                  <Box component="td" sx={{ color: "text.disabled", pr: 1.75, py: 0.25, whiteSpace: "nowrap" }}>
                    {d.label}
                  </Box>
                  <Box component="td" sx={{ ...reading, color: "text.primary", py: 0.25 }}>
                    {d.value}
                  </Box>
                </tr>
              ))}
            </tbody>
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
