"use client";

/**
 * /admin/db — Mongo database summary: total size, per-collection doc counts
 * and storage/index sizes. Read-only info page, no operator actions.
 */
import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { useTableSort } from "../../../components/admin/useTableSort";
import { font, surface } from "../../../theme/tokens";

interface CollectionSummary {
  name: string;
  count: number;
  avgObjSize: number;
  dataSize: number;
  storageSize: number;
  indexSize: number;
  indexCount: number;
  totalSize: number;
}

interface DbSummary {
  db: string;
  dbStats: {
    collections: number;
    objects: number;
    dataSize: number;
    storageSize: number;
    indexSize: number;
    totalSize: number;
  };
  collections: CollectionSummary[];
  at: string;
}

/** DESIGN_BIBLE §3: byte sizes and doc counts are readings — mono, tabular. */
const reading = { fontFamily: font.mono, fontVariantNumeric: "tabular-nums" } as const;

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

export default function DbSummaryPage() {
  const [summary, setSummary] = useState<DbSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/db", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setSummary(body);
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const maxSize = summary ? Math.max(1, ...summary.collections.map((c) => c.totalSize)) : 1;
  const sorted = useTableSort(summary?.collections ?? [], {
    collection: (c) => c.name,
    docs: (c) => c.count,
    average: (c) => c.avgObjSize,
    data: (c) => c.dataSize,
    storage: (c) => c.storageSize,
    indexes: (c) => c.indexSize,
    total: (c) => c.totalSize,
  }, "total", true);

  return (
    <AdminPageShell
      title="Database"
      description="Mongo collection sizes, document counts and storage summary."
      maxWidth={980}
      actions={
        <Button variant="outlined" onClick={refresh}>
          Refresh
        </Button>
      }
    >
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {summary && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {summary.db} · as of <Box component="span" sx={reading}>{new Date(summary.at).toLocaleTimeString()}</Box>
          </Typography>

          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 1.5, mt: 2 }}>
            {[
              ["Collections", formatCount(summary.dbStats.collections)],
              ["Documents", formatCount(summary.dbStats.objects)],
              ["Data size", formatBytes(summary.dbStats.dataSize)],
              ["Storage size", formatBytes(summary.dbStats.storageSize)],
              ["Index size", formatBytes(summary.dbStats.indexSize)],
              ["Total on disk", formatBytes(summary.dbStats.totalSize)],
            ].map(([label, value]) => (
              <Paper key={label} sx={{ p: 1.75 }}>
                <Typography variant="overline" color="text.secondary" component="div">
                  {label}
                </Typography>
                <Typography sx={{ ...reading, fontSize: 18, fontWeight: 600, mt: 0.5 }}>{value}</Typography>
              </Paper>
            ))}
          </Box>

          <Table sx={{ mt: 3 }}>
            <TableHead>
              <TableRow>
                <TableCell>{sorted.header("collection", "Collection")}</TableCell>
                <TableCell align="right">{sorted.header("docs", "Docs")}</TableCell>
                <TableCell align="right">{sorted.header("average", "Avg doc")}</TableCell>
                <TableCell align="right">{sorted.header("data", "Data")}</TableCell>
                <TableCell align="right">{sorted.header("storage", "Storage")}</TableCell>
                <TableCell align="right">{sorted.header("indexes", "Indexes")}</TableCell>
                <TableCell align="right">{sorted.header("total", "Total")}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.rows.map((c) => (
                <TableRow key={c.name}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell align="right" sx={reading}>{formatCount(c.count)}</TableCell>
                  <TableCell align="right" sx={{ ...reading, color: "text.secondary" }}>{formatBytes(c.avgObjSize)}</TableCell>
                  <TableCell align="right" sx={reading}>{formatBytes(c.dataSize)}</TableCell>
                  <TableCell align="right" sx={reading}>{formatBytes(c.storageSize)}</TableCell>
                  <TableCell align="right" sx={{ ...reading, color: "text.secondary" }}>
                    {formatBytes(c.indexSize)} ({c.indexCount})
                  </TableCell>
                  <TableCell align="right" sx={{ ...reading, fontWeight: 600 }}>{formatBytes(c.totalSize)}</TableCell>
                  <TableCell sx={{ width: 100 }}>
                    <Box sx={{ height: 6, borderRadius: 0.75, bgcolor: surface.raised }}>
                      <Box
                        sx={{
                          height: "100%",
                          width: `${Math.max(2, (c.totalSize / maxSize) * 100)}%`,
                          borderRadius: 0.75,
                          bgcolor: "primary.main",
                        }}
                      />
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {!summary && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Loading…
        </Typography>
      )}
    </AdminPageShell>
  );
}
