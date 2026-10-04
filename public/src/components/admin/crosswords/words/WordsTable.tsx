"use client";

/**
 * One page of bank words: word, length, clue status, approval, family friendly, part of speech,
 * categories, flags, clue model, validation decision, frequency, clue count
 * and the clue writer's reason. Each word links to its detail page.
 */
import Link from "next/link";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { BankWordRow } from "@photonsurge/shared/crossword-bank";
import { font } from "../../../../theme/tokens";
import { wordHref } from "./api";
import { ApprovalChip, ClueStatusChip, DecisionChip, FamilyChip, FlagChips, zipfLabel } from "./chips";

/** Categories are noisy slugs (§7.2): show a few and count the rest. */
const MAX_CATEGORIES = 3;

function categoriesLabel(cats: string[]): string {
  if (!cats.length) return "—";
  const shown = cats.slice(0, MAX_CATEGORIES).join(", ");
  return cats.length > MAX_CATEGORIES ? `${shown} +${cats.length - MAX_CATEGORIES}` : shown;
}

export default function WordsTable({ rows }: { rows: BankWordRow[] }) {
  return (
    <Paper>
      <TableContainer>
        <Table size="small" aria-label="Words">
          <TableHead>
            <TableRow>
              <TableCell>Word</TableCell>
              <TableCell align="right">Len</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Approval</TableCell>
              <TableCell>Family friendly</TableCell>
              <TableCell>POS</TableCell>
              <TableCell>Categories</TableCell>
              <TableCell>Flags</TableCell>
              <TableCell>Model</TableCell>
              <TableCell>Decision</TableCell>
              <TableCell>Frequency</TableCell>
              <TableCell align="right">Clues</TableCell>
              <TableCell>Reason</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13}>
                  <Typography color="text.secondary" variant="body2">
                    No words match these filters.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>
                    <MuiLink component={Link} href={wordHref(r.id)} sx={{ fontFamily: font.mono, fontWeight: 600 }}>
                      {r.word}
                    </MuiLink>
                  </TableCell>
                  <TableCell align="right">{r.length}</TableCell>
                  <TableCell>
                    <ClueStatusChip status={r.clueStatus} />
                  </TableCell>
                  <TableCell>
                    <ApprovalChip approval={r.approval} />
                  </TableCell>
                  <TableCell>
                    <FamilyChip value={r.familyFriendly} />
                  </TableCell>
                  <TableCell>{r.pos.join(", ") || "—"}</TableCell>
                  <TableCell sx={{ maxWidth: 220 }} title={r.categories.join(", ")}>
                    {categoriesLabel(r.categories)}
                  </TableCell>
                  <TableCell>
                    <FlagChips flags={r.flags} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: font.mono, fontSize: 12 }}>{r.model ?? "—"}</TableCell>
                  <TableCell>
                    <DecisionChip decision={r.decision} by={r.decisionBy} />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{zipfLabel(r.zipf)}</TableCell>
                  <TableCell align="right">{r.clueCount}</TableCell>
                  <TableCell sx={{ maxWidth: 260, color: "text.secondary" }}>{r.reason ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
