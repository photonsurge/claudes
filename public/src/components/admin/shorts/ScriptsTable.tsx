"use client";

/**
 * The saved short scripts, newest first: title, scope, length, clip count,
 * when it was made, and how its last PREVIEW play went. Clicking a row selects
 * it; Preview plays it on the preview scene; Delete asks first.
 */
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import {
  formatDuration,
  previewPlayState,
  scopeLabel,
  type PreviewPlayState,
  type ShortListItem,
  type ShortPreviewInfo,
} from "../../../lib/shorts";
import { font } from "../../../theme/tokens";

const STATE_LABEL: Record<PreviewPlayState, string> = {
  never: "never played",
  starting: "starting…",
  playing: "playing",
  ended: "ended",
  stopped: "stopped",
};
const STATE_COLOR: Record<PreviewPlayState, "default" | "info" | "success" | "warning"> = {
  never: "default",
  starting: "info",
  playing: "success",
  ended: "default",
  stopped: "warning",
};

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

interface Props {
  scripts: ShortListItem[];
  preview: ShortPreviewInfo;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
  onDelete: (id: string) => void;
  /** Disables the row actions (a request is in flight). */
  busy?: boolean;
  /** Injectable for tests. */
  confirmDelete?: (message: string) => boolean;
}

export default function ScriptsTable({
  scripts,
  preview,
  selectedId,
  onSelect,
  onPreview,
  onDelete,
  busy,
  confirmDelete = (m) => window.confirm(m),
}: Props) {
  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        Scripts ({scripts.length})
      </Typography>
      <Table size="small" sx={{ mt: 1 }}>
        <TableHead>
          <TableRow>
            <TableCell>Title</TableCell>
            <TableCell>Scope</TableCell>
            <TableCell sx={numHead}>Length</TableCell>
            <TableCell sx={numHead}>Clips</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Last preview</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {scripts.map((s) => {
            const state = previewPlayState(s, preview);
            const skipped = state === "starting" ? 0 : (s.previewPlay?.skipped.length ?? 0);
            return (
              <TableRow
                key={s.id}
                hover
                selected={s.id === selectedId}
                onClick={() => onSelect(s.id)}
                sx={{ cursor: "pointer" }}
              >
                <TableCell sx={{ fontWeight: 600 }}>{s.title}</TableCell>
                <TableCell>{scopeLabel(s.scope)}</TableCell>
                <TableCell sx={numCell}>{formatDuration(s.durationMs)}</TableCell>
                <TableCell sx={numCell}>{s.clipCount}</TableCell>
                <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{fmtTime(s.created)}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                    <Chip size="small" label={STATE_LABEL[state]} color={STATE_COLOR[state]} variant="outlined" />
                    {skipped > 0 && (
                      <Typography variant="caption" color="warning.main">
                        {skipped} skipped
                      </Typography>
                    )}
                  </Stack>
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                  <Button size="small" onClick={() => onPreview(s.id)} disabled={busy || !preview.exists || !s.clipCount}>
                    Preview
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={busy}
                    onClick={() => {
                      if (confirmDelete(`Delete “${s.title}”? This can't be undone.`)) onDelete(s.id);
                    }}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
          {!scripts.length && (
            <TableRow>
              <TableCell colSpan={7} sx={{ color: "text.disabled" }}>
                No scripts yet — generate a round-up above.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}

/** Measurements, so mono + tabular — the columns must align. */
const numCell = { textAlign: "right", fontFamily: font.mono, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
const numHead = { textAlign: "right" } as const;
