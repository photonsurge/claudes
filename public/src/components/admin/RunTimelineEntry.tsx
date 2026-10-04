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
import IconButton from "@mui/material/IconButton";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { fmtDuration, kindColor, type AirEntry } from "../../lib/airlog";
import { font } from "../../theme/tokens";

/** How the as-run log names each break-in reason. */
export const BREAK_IN_REASON_LABEL: Record<"quake" | "storm" | "volcano" | "roundup", string> = {
  quake: "new quake",
  storm: "new warning",
  volcano: "eruption",
  roundup: "new round-up",
};

const timeOf = (iso: string): string => new Date(iso).toISOString().slice(11, 19);

/** DESIGN_BIBLE §3: air times, holds and coordinates are readings. */
const reading = { fontFamily: font.mono, fontVariantNumeric: "tabular-nums" } as const;

/** The subject part of "kind:subject" ids; storm ids link to the alert page. */
function subjectOf(e: AirEntry): { label: string; href?: string } {
  const label = e.segmentId.includes(":") ? e.segmentId.slice(e.segmentId.indexOf(":") + 1) : e.segmentId;
  if (e.kind === "storm") return { label, href: `/admin/alerts/${encodeURIComponent(label)}` };
  return { label };
}

export interface RunTimelineEntryProps {
  entry: AirEntry;
  isLast: boolean;
  /** Replaces the wall-clock stamp on the rail — a video offset on the VOD page. */
  railLabel?: string;
  /** ▶ under the rail label: seek the page's player to this cut. */
  onSeek?: () => void;
  /** ▶ as a link instead (the watch URL at this offset) when there's no player. */
  seekHref?: string;
  /** A short mark on the title row, e.g. "joined in progress". */
  note?: string;
  /** Link subjects into /admin (alerts). Off on public surfaces, which can't reach /admin. */
  subjectLinks?: boolean;
  /** One per `entry.stops`: an estimated offset label (and seek) for each round-up stop. */
  stopRail?: { label: string; onSeek?: () => void }[];
}

export default function RunTimelineEntry({
  entry,
  isLast,
  railLabel,
  onSeek,
  seekHref,
  note,
  subjectLinks = true,
  stopRail,
}: RunTimelineEntryProps) {
  const [open, setOpen] = useState(false);
  const color = kindColor(entry.kind);
  const subject = subjectLinks ? subjectOf(entry) : { label: subjectOf(entry).label };
  const cutShort = entry.endReason === "skipped";
  const onAirNow = !entry.endedAt && !entry.endReason;

  return (
    <Stack direction="row" spacing={1.75}>
      {/* Rail: air time, kind-coloured dot, connector down to the next cut. */}
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", width: 74, flexShrink: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ ...reading, fontSize: 11 }}>
          {railLabel ?? timeOf(entry.startedAt)}
        </Typography>
        {onSeek ? (
          <IconButton
            size="small"
            aria-label={`Play from ${railLabel ?? timeOf(entry.startedAt)}`}
            onClick={onSeek}
            sx={{ p: 0.25, fontSize: 12, lineHeight: 1 }}
          >
            ▶
          </IconButton>
        ) : seekHref ? (
          <MuiLink
            href={seekHref}
            target="_blank"
            aria-label={`Play from ${railLabel ?? timeOf(entry.startedAt)}`}
            sx={{ fontSize: 12, lineHeight: 1.4 }}
          >
            ▶
          </MuiLink>
        ) : null}
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
          {entry.breakIn ? (
            <Chip
              title={entry.breakIn.interrupted ? "Cut the previous shot short for breaking news" : "Jumped the queue at a shot change"}
              label={`⚡ break-in · ${BREAK_IN_REASON_LABEL[entry.breakIn.reason]}${entry.breakIn.interrupted ? " · interrupted" : ""}`}
              color="warning"
            />
          ) : (
            entry.breaking && <Chip title="Aired via the breaking-news priority tier" label="⚡ breaking" color="warning" />
          )}
          {entry.command && (
            <Chip
              title={entry.command.source === "viewer" ? "Requested from live chat" : "Ordered from the director desk"}
              label={entry.command.source === "viewer" ? `💬 @${entry.command.author ?? "viewer"}` : `👤 ${entry.command.source}`}
            />
          )}
          {entry.timesShown > 1 && (
            <Chip title="Nth airing of this segment in the session" label={`×${entry.timesShown}`} />
          )}
          {onAirNow && <Chip label="● on air" color="error" />}
          {note && <Chip label={note} sx={{ color: "text.secondary" }} />}
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

        {/* A grouped break-in: every event the one cut covered. */}
        {(entry.breakInItems?.length ?? 0) > 1 && (
          <Box sx={{ mt: 1, borderLeft: 2, borderColor: "warning.main", pl: 1.25 }} aria-label="Break-in members">
            {entry.breakInItems!.map((item) => (
              <Typography key={item.segmentId} variant="caption" color="text.secondary" component="div" sx={{ py: 0.25 }}>
                ⚡ {item.title}
                {item.subtitle ? <Box component="span" sx={{ color: "text.disabled" }}> · {item.subtitle}</Box> : null}
              </Typography>
            ))}
          </Box>
        )}

        {/* Sub-views: the camera stops this shot toured through, in order. */}
        {!!entry.stops?.length && (
          <Box sx={{ mt: 1, borderLeft: 2, borderColor: "divider", pl: 1.25 }}>
            {entry.stops.map((s, i) => (
              <Typography key={i} variant="caption" color="text.secondary" component="div" sx={{ py: 0.25 }}>
                {stopRail?.[i] && (
                  <Box component="span" sx={{ ...reading, color: "text.disabled", mr: 0.5 }}>
                    {stopRail[i].onSeek ? (
                      <MuiLink
                        component="button"
                        type="button"
                        aria-label={`Play from ${stopRail[i].label}`}
                        onClick={(ev: React.MouseEvent) => {
                          ev.stopPropagation();
                          stopRail[i].onSeek?.();
                        }}
                        sx={{ ...reading, fontSize: "inherit", verticalAlign: "baseline" }}
                      >
                        ▶ {stopRail[i].label}
                      </MuiLink>
                    ) : (
                      stopRail[i].label
                    )}
                  </Box>
                )}
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
