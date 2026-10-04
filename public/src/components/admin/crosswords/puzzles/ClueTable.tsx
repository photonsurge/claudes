"use client";

/**
 * A puzzle's clues with their answers, across then down. Read only: clues are
 * edited in Words. Each answer links to its Words page (a search, for a seed
 * entry that has no bank word).
 */
import Link from "next/link";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { CrosswordEntry } from "@photonsurge/shared/crossword";
import { font } from "../../../../theme/tokens";
import { wordHref } from "./api";

interface Props {
  entries: CrosswordEntry[];
  onFocus?: (entryId: string | null) => void;
}

export default function ClueTable({ entries, onFocus }: Props) {
  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        Clues ({entries.length})
      </Typography>
      <Table size="small" sx={{ mt: 1 }}>
        <TableHead>
          <TableRow>
            <TableCell>Ref</TableCell>
            <TableCell>Answer</TableCell>
            <TableCell>Clue</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id} hover onMouseEnter={() => onFocus?.(e.id)} onMouseLeave={() => onFocus?.(null)}>
              <TableCell sx={{ fontFamily: font.mono, whiteSpace: "nowrap" }}>{e.id}</TableCell>
              <TableCell sx={{ fontFamily: font.mono, fontWeight: 700, whiteSpace: "nowrap" }}>
                <MuiLink component={Link} href={wordHref(e)} title="Open in Words">
                  {e.answer}
                </MuiLink>
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                  ({e.answer.length})
                </Typography>
              </TableCell>
              <TableCell sx={{ width: "100%" }}>{e.clue}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
