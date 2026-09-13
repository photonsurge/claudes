"use client";

/**
 * The top-right report deck's slide list: show/hide plus up/down movers, and
 * the "n of m shown" line under it. Presentation only — the card owns staging.
 */
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  BROADCAST_REPORT_SLIDES,
  REPORT_SLIDE_IDS,
  type ReportSlideId,
} from "@photonsurge/shared/broadcast-report";

const REPORT_BY_ID = new Map(BROADCAST_REPORT_SLIDES.map((s) => [s.id, s]));

export default function ReportOrderList({
  ordered,
  off,
  onToggle,
  onMove,
}: {
  ordered: ReportSlideId[];
  off: ReadonlySet<string>;
  onToggle: (id: ReportSlideId, visible: boolean) => void;
  onMove: (id: ReportSlideId, dir: -1 | 1) => void;
}) {
  const shownCount = REPORT_SLIDE_IDS.length - off.size;

  return (
    <>
      <Box sx={{ display: "grid", gap: 0.5 }}>
        {ordered.map((id, idx) => {
          const s = REPORT_BY_ID.get(id);
          if (!s) return null;
          return (
            <Stack key={id} direction="row" spacing={1} sx={{ alignItems: "center", py: 0.25 }}>
              <Checkbox
                size="small"
                checked={!off.has(id)}
                onChange={(e) => onToggle(id, e.target.checked)}
                slotProps={{ input: { "aria-label": s.label } }}
                sx={{ p: 0.5 }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2">{s.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {s.note}
                </Typography>
              </Box>
              <IconButton
                size="small"
                disabled={idx === 0}
                onClick={() => onMove(id, -1)}
                aria-label={`Move ${s.label} up`}
                sx={{ p: 0.25, width: 24, height: 24 }}
              >
                ↑
              </IconButton>
              <IconButton
                size="small"
                disabled={idx === ordered.length - 1}
                onClick={() => onMove(id, 1)}
                aria-label={`Move ${s.label} down`}
                sx={{ p: 0.25, width: 24, height: 24 }}
              >
                ↓
              </IconButton>
            </Stack>
          );
        })}
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        {shownCount === 0
          ? "Nothing shown — the world report is hidden on this channel."
          : `${shownCount} of ${REPORT_SLIDE_IDS.length} slides shown.`}
      </Typography>
    </>
  );
}
