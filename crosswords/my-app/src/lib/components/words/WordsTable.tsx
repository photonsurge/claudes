import Link from "next/link";
import { Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import { WordListItem } from "./types";

type Props = {
  items: WordListItem[];
  sort: string;
  hrefForSort: (sort: string) => string;
};

const WordsTable = ({ items, sort, hrefForSort }: Props) => {
  const wordActive = sort === "word_asc" || sort === "word_desc";
  const lenActive = sort === "length_asc" || sort === "length_desc";
  const nextWordSort = sort === "word_asc" ? "word_desc" : "word_asc";
  const nextLenSort = sort === "length_asc" ? "length_desc" : "length_asc";

  const sortBadge = (active: boolean, ascending: boolean) => {
    if (!active) return "";
    return ascending ? " ↑" : " ↓";
  };

  const validationColor = (decision?: string) => {
    if (decision === "accepted") return "success";
    if (decision === "review") return "warning";
    if (decision === "reject") return "error";
    return "default";
  };

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>
              <Link href={hrefForSort(nextWordSort)} style={{ textDecoration: "none", fontWeight: 700 }}>
                Word{sortBadge(wordActive, sort === "word_asc")}
              </Link>
            </TableCell>
            <TableCell sx={{ width: 90 }}>
              <Link href={hrefForSort(nextLenSort)} style={{ textDecoration: "none", fontWeight: 700 }}>
                Len{sortBadge(lenActive, sort === "length_asc")}
              </Link>
            </TableCell>
            <TableCell sx={{ width: 140 }}>Status</TableCell>
            <TableCell sx={{ width: 160 }}>Type</TableCell>
            <TableCell sx={{ width: 280 }}>Model</TableCell>
            <TableCell sx={{ width: 180 }}>Validation</TableCell>
            <TableCell sx={{ width: 90 }}>Clues</TableCell>
            <TableCell>Reason</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((w) => (
            <TableRow key={w._id} hover>
              <TableCell>
                <Link href={`/words/${w._id}`} style={{ textDecoration: "none", fontWeight: 700 }}>
                  {w.norm || w.word || "(unknown)"}
                </Link>
              </TableCell>
              <TableCell>{w.length ?? "-"}</TableCell>
              <TableCell>
                <Chip label={w.enrichment?.status ?? "unknown"} size="small" />
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary">
                  {Array.isArray(w.pos) && w.pos.length > 0 ? w.pos.join(", ") : "-"}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                  {w.enrichment?.model || "-"}
                </Typography>
              </TableCell>
              <TableCell>
                <Chip
                  label={w.validation?.decision ?? "n/a"}
                  size="small"
                  color={validationColor(w.validation?.decision)}
                  variant={w.validation?.decision ? "filled" : "outlined"}
                />
                <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.25 }}>
                  score: {typeof w.validation?.score === "number" ? w.validation.score.toFixed(2) : "-"}
                </Typography>
              </TableCell>
              <TableCell>{w.clueCount ?? 0}</TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary">
                  {w.enrichment?.reason || ""}
                </Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default WordsTable;
