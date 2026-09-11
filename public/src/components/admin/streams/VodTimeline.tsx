"use client";

/**
 * The as-run timeline of one video (/admin/streams/:id, /vod/:videoId): the
 * director's cuts at their video offsets, with the stretches nothing was logged
 * for drawn as explicit gaps so the rows add up to the video's length. Cuts
 * reuse the /admin/runs/:id row; ▶ seeks the page's player when it's up, else
 * opens the watch URL at that offset. Round-up stops carry no times in the log,
 * so they get an ESTIMATE (spread evenly across the shot, marked ≈). Optional
 * chat messages are interleaved after the cut that was on air when they landed.
 */
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { fmtOffset, vodSeekUrl, type AsRunGapReason, type AsRunItem } from "@photonsurge/shared/vod";
import RunTimelineEntry from "../RunTimelineEntry";
import { fmtDuration, type AirEntry } from "../../../lib/airlog";
import { font } from "../../../theme/tokens";

const reading = { fontFamily: font.mono, fontVariantNumeric: "tabular-nums" } as const;

/** A chat message placed on the video's timeline. */
export interface VodChatLine {
  id: string;
  offsetMs: number;
  author: string;
  text: string;
}

/**
 * Estimated video offsets of a shot's round-up stops: the log records the
 * stops but not when each was reached, so spread them evenly over the shot.
 */
export function estimateStopOffsets(offsetMs: number, endOffsetMs: number | null, count: number): number[] {
  if (count <= 0) return [];
  if (endOffsetMs == null || endOffsetMs <= offsetMs) return Array.from({ length: count }, () => offsetMs);
  const step = (endOffsetMs - offsetMs) / count;
  return Array.from({ length: count }, (_, i) => Math.round(offsetMs + i * step));
}

function ChatRows({ lines }: { lines: VodChatLine[] }) {
  return (
    <Stack direction="row" spacing={1.75}>
      <Box sx={{ width: 74, flexShrink: 0, display: "flex", justifyContent: "center" }}>
        <Box sx={{ width: 2, flex: 1, bgcolor: "divider" }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, mb: 1.75, pl: 1.75, borderLeft: 2, borderColor: "divider" }}>
        {lines.map((m) => (
          <Typography key={m.id} variant="caption" color="text.secondary" component="div" sx={{ py: 0.125 }}>
            <Box component="span" sx={{ ...reading, color: "text.disabled", mr: 0.75 }}>
              {fmtOffset(m.offsetMs)}
            </Box>
            <Box component="span" sx={{ fontWeight: 600 }}>
              {m.author}
            </Box>
            {" "}
            {m.text}
          </Typography>
        ))}
      </Box>
    </Stack>
  );
}

const GAP_TEXT: Record<AsRunGapReason, string> = {
  "before-first-cut": "before the director's first cut",
  "between-cuts": "between cuts",
  "after-last-cut": "after the director's last cut",
};

function GapRow({ item, isLast }: { item: Extract<AsRunItem<AirEntry>, { type: "gap" }>; isLast: boolean }) {
  return (
    <Stack direction="row" spacing={1.75}>
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", width: 74, flexShrink: 0 }}>
        <Typography variant="caption" color="text.disabled" sx={{ ...reading, fontSize: 11 }}>
          {fmtOffset(item.offsetMs)}
        </Typography>
        <Box sx={{ width: 11, height: 11, borderRadius: "50%", border: 2, borderColor: "divider", mt: 0.5, flexShrink: 0 }} />
        {!isLast && <Box sx={{ width: 2, flex: 1, borderLeft: "2px dashed", borderColor: "divider", mt: 0.5 }} />}
      </Box>
      <Paper variant="outlined" sx={{ flex: 1, minWidth: 0, mb: 1.75, px: 1.75, py: 1, borderStyle: "dashed", bgcolor: "transparent" }}>
        <Typography variant="caption" color="text.secondary">
          No cut logged · {fmtDuration(item.endOffsetMs - item.offsetMs)} {GAP_TEXT[item.reason]} — operator-driven, or the
          director was off
        </Typography>
      </Paper>
    </Stack>
  );
}

export default function VodTimeline({
  items,
  watchUrl,
  onSeek,
  subjectLinks = true,
  chat,
}: {
  items: AsRunItem<AirEntry>[];
  watchUrl?: string | null;
  /** Seek the page's player; when absent, ▶ opens the watch URL at the offset. */
  onSeek?: (offsetMs: number) => void;
  /** Link subjects into /admin; off on the public /vod page. */
  subjectLinks?: boolean;
  /** Chat to interleave, in time order (already at video offsets). */
  chat?: VodChatLine[];
}) {
  const sortedChat = chat ? [...chat].sort((a, b) => a.offsetMs - b.offsetMs) : [];
  let chatIdx = 0;
  /** Chat that landed before `untilMs` and hasn't been placed yet. */
  const chatUntil = (untilMs: number | null): VodChatLine[] => {
    const out: VodChatLine[] = [];
    while (chatIdx < sortedChat.length && (untilMs == null || sortedChat[chatIdx].offsetMs < untilMs)) {
      out.push(sortedChat[chatIdx++]);
    }
    return out;
  };

  const rows: React.ReactNode[] = [];
  items.forEach((item, i) => {
    const isLast = i === items.length - 1;
    const nextOffset = isLast ? null : items[i + 1].offsetMs;
    if (item.type === "gap") {
      rows.push(<GapRow key={`gap-${item.offsetMs}`} item={item} isLast={isLast} />);
    } else {
      const note = item.clippedStart ? "joined in progress" : item.clippedEnd ? "ran past the end" : undefined;
      const stopOffsets = estimateStopOffsets(item.offsetMs, item.endOffsetMs, item.entry.stops?.length ?? 0);
      rows.push(
        <RunTimelineEntry
          key={item.entry.id}
          entry={item.entry}
          isLast={isLast}
          railLabel={fmtOffset(item.offsetMs)}
          onSeek={onSeek ? () => onSeek(item.offsetMs) : undefined}
          seekHref={!onSeek && watchUrl ? vodSeekUrl(watchUrl, item.offsetMs) : undefined}
          note={note}
          subjectLinks={subjectLinks}
          stopRail={stopOffsets.map((ms) => ({ label: `≈${fmtOffset(ms)}`, onSeek: onSeek ? () => onSeek(ms) : undefined }))}
        />,
      );
    }
    const lines = chatUntil(nextOffset);
    if (lines.length) rows.push(<ChatRows key={`chat-${item.offsetMs}`} lines={lines} />);
  });
  return <Box>{rows}</Box>;
}
