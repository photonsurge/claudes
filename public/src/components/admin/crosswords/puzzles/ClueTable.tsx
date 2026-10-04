"use client";

/**
 * A puzzle's clues with their answers, across then down. Each row edits its
 * clue in place (Save sends it; the route cleans and validates it and refuses
 * one that can't air), drops the word (asks first), and links the answer to
 * the Words admin.
 */
import { useState } from "react";
import Link from "next/link";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { CLUE_MAX, type CrosswordEntry } from "@photonsurge/shared/crossword";
import { font } from "../../../../theme/tokens";
import { wordSearchHref } from "./api";

interface Props {
  entries: CrosswordEntry[];
  busy?: boolean;
  /** Resolves true when saved; the row keeps the draft on a refusal. */
  onSaveClue: (entryId: string, clue: string) => Promise<boolean>;
  onDrop: (entryId: string) => void;
  onFocus?: (entryId: string | null) => void;
  /** Injectable for tests. */
  confirmDrop?: (message: string) => boolean;
}

export default function ClueTable({ entries, busy, onSaveClue, onDrop, onFocus, confirmDrop = (m) => window.confirm(m) }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

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
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map((e) => {
            const draft = drafts[e.id];
            const dirty = draft != null && draft !== e.clue;
            return (
              <TableRow key={e.id} hover onMouseEnter={() => onFocus?.(e.id)} onMouseLeave={() => onFocus?.(null)}>
                <TableCell sx={{ fontFamily: font.mono, whiteSpace: "nowrap" }}>{e.id}</TableCell>
                <TableCell sx={{ fontFamily: font.mono, fontWeight: 700, whiteSpace: "nowrap" }}>
                  <MuiLink component={Link} href={wordSearchHref(e.answer)} title="Open in Words">
                    {e.answer}
                  </MuiLink>
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                    ({e.answer.length})
                  </Typography>
                </TableCell>
                <TableCell sx={{ width: "100%" }}>
                  <TextField
                    size="small"
                    fullWidth
                    value={draft ?? e.clue}
                    onChange={(ev) => setDrafts((d) => ({ ...d, [e.id]: ev.target.value }))}
                    helperText={dirty ? `${(draft ?? "").trim().length}/${CLUE_MAX}` : undefined}
                    slotProps={{ htmlInput: { "aria-label": `Clue for ${e.id}` } }}
                  />
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                  <Button
                    size="small"
                    disabled={busy || !dirty}
                    onClick={async () => {
                      if (!(await onSaveClue(e.id, draft ?? e.clue))) return;
                      setDrafts((d) => {
                        const { [e.id]: _gone, ...rest } = d;
                        return rest;
                      });
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={busy}
                    onClick={() => {
                      if (confirmDrop(`Drop ${e.id} ${e.answer}? The other words keep their places and are renumbered.`)) onDrop(e.id);
                    }}
                  >
                    Drop
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Paper>
  );
}
