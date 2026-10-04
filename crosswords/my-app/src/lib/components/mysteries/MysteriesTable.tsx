import Link from "next/link";
import { Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import { MysteryListItem } from "./types";

type Props = {
  items: MysteryListItem[];
  sort: string;
  hrefForSort: (sort: string) => string;
};

const fmtDate = (raw: string | null) => {
  if (!raw) return "-";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
};

const sortBadge = (active: boolean, ascending: boolean) => {
  if (!active) return "";
  return ascending ? " ↑" : " ↓";
};

const MysteriesTable = ({ items, sort, hrefForSort }: Props) => {
  const titleActive = sort === "title_asc" || sort === "title_desc";
  const createdActive = sort === "created_asc" || sort === "created_desc";
  const updatedActive = sort === "updated_asc" || sort === "updated_desc";

  const nextTitleSort = sort === "title_asc" ? "title_desc" : "title_asc";
  const nextCreatedSort = sort === "created_asc" ? "created_desc" : "created_asc";
  const nextUpdatedSort = sort === "updated_asc" ? "updated_desc" : "updated_asc";

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>
              <Link href={hrefForSort(nextTitleSort)} style={{ textDecoration: "none", fontWeight: 700 }}>
                Title{sortBadge(titleActive, sort === "title_asc")}
              </Link>
            </TableCell>
            <TableCell sx={{ width: 360 }}>Logline</TableCell>
            <TableCell sx={{ width: 100 }}>Chapters</TableCell>
            <TableCell sx={{ width: 140 }}>Visuals</TableCell>
            <TableCell sx={{ width: 220 }}>
              <Link href={hrefForSort(nextCreatedSort)} style={{ textDecoration: "none", fontWeight: 700 }}>
                Created{sortBadge(createdActive, sort === "created_asc")}
              </Link>
            </TableCell>
            <TableCell sx={{ width: 220 }}>
              <Link href={hrefForSort(nextUpdatedSort)} style={{ textDecoration: "none", fontWeight: 700 }}>
                Updated{sortBadge(updatedActive, sort === "updated_asc")}
              </Link>
            </TableCell>
            <TableCell sx={{ width: 180 }}>Kind</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((m) => (
            <TableRow key={m._id} hover>
              <TableCell>
                <Link href={`/mysteries/${m._id}`} style={{ textDecoration: "none", fontWeight: 700 }}>
                  {m.title || "(untitled)"}
                </Link>
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary">
                  {m.logline || "-"}
                </Typography>
              </TableCell>
              <TableCell>{m.chapterCount ?? 0}</TableCell>
              <TableCell>{`${m.characterVisualCount ?? 0}C / ${m.locationVisualCount ?? 0}L`}</TableCell>
              <TableCell>{fmtDate(m.createdAt)}</TableCell>
              <TableCell>{fmtDate(m.updatedAt)}</TableCell>
              <TableCell>{m.kind || "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default MysteriesTable;
