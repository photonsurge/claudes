"use client";

/**
 * The puzzle stock, newest first: title and theme, status, source, size and
 * word count, plays and when last played, when built. A title opens the
 * puzzle's detail page (grid, clues, review actions).
 */
import Link from "next/link";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { CrosswordPuzzleStatus } from "@photonsurge/shared/crossword";
import { font } from "../../../../theme/tokens";
import { fmtTime, type PuzzleRow } from "./api";

export const STATUS_COLOR: Record<CrosswordPuzzleStatus, "default" | "success" | "error"> = {
  ready: "success",
  rejected: "error",
};

export default function PuzzlesTable({ puzzles }: { puzzles: PuzzleRow[] }) {
  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        Puzzles ({puzzles.length})
      </Typography>
      <Table size="small" sx={{ mt: 1 }}>
        <TableHead>
          <TableRow>
            <TableCell>Title</TableCell>
            <TableCell>Theme</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Source</TableCell>
            <TableCell sx={numHead}>Words</TableCell>
            <TableCell sx={numHead}>Size</TableCell>
            <TableCell sx={numHead}>Plays</TableCell>
            <TableCell>Last played</TableCell>
            <TableCell>Built</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {puzzles.map((p) => (
            <TableRow key={p.id} hover>
              <TableCell sx={{ fontWeight: 600 }}>
                <MuiLink component={Link} href={`/admin/crosswords/puzzles/${encodeURIComponent(p.id)}`}>
                  {p.title || p.id}
                </MuiLink>
              </TableCell>
              <TableCell>{p.theme || "—"}</TableCell>
              <TableCell>
                <Chip size="small" variant="outlined" label={p.status} color={STATUS_COLOR[p.status]} />
              </TableCell>
              <TableCell>
                {p.source}
                {p.model && (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                    {p.model}
                  </Typography>
                )}
              </TableCell>
              <TableCell sx={numCell}>{p.words}</TableCell>
              <TableCell sx={numCell}>
                {p.width}×{p.height}
              </TableCell>
              <TableCell sx={numCell} title={p.scenes.join(", ")}>
                {p.plays}
              </TableCell>
              <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{fmtTime(p.lastPlayedAt)}</TableCell>
              <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{fmtTime(p.createdAt)}</TableCell>
            </TableRow>
          ))}
          {!puzzles.length && (
            <TableRow>
              <TableCell colSpan={9} sx={{ color: "text.disabled" }}>
                No puzzles match. Generate one above.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}

const numCell = { textAlign: "right", fontFamily: font.mono, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
const numHead = { textAlign: "right" } as const;
