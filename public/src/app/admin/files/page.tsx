"use client";

/**
 * /admin/files — the shared ${BLOB_DIR} blob folder: what each namespace is
 * storing, how much disk is left, and any leftover temp writes. Read-only info
 * page, no operator actions. The filesystem-side sibling of /admin/db.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { useTableSort } from "../../../components/admin/useTableSort";
import { font, surface } from "../../../theme/tokens";

interface NamespaceUsage {
  ns: string;
  label: string;
  desc: string;
  known: boolean;
  files: number;
  bytes: number;
  tmpFiles: number;
  tmpBytes: number;
  largestBytes: number;
  newestMs: number | null;
  oldestMs: number | null;
}

interface FilesSummary {
  enabled: boolean;
  root?: string;
  files?: number;
  bytes?: number;
  tmpFiles?: number;
  tmpBytes?: number;
  disk?: { totalBytes: number; freeBytes: number; usedBytes: number } | null;
  namespaces?: NamespaceUsage[];
  emptyNamespaces?: string[];
  tookMs?: number;
  at: string;
}

/** DESIGN_BIBLE §3: sizes, counts and ages are readings — mono, tabular. */
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

function formatAge(ms: number | null): string {
  if (!ms) return "—";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default function FilesPage() {
  const [summary, setSummary] = useState<FilesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/files", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setSummary(body);
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const namespaces = summary?.namespaces ?? [];
  const maxSize = Math.max(1, ...namespaces.map((n) => n.bytes));
  const sorted = useTableSort(namespaces, {
    namespace: (n) => n.label,
    files: (n) => n.files,
    size: (n) => n.bytes,
    largest: (n) => n.largestBytes,
    newest: (n) => n.newestMs ?? 0,
    oldest: (n) => n.oldestMs ?? 0,
    temp: (n) => n.tmpBytes,
  }, "size", true);

  const diskPct = summary?.disk ? (summary.disk.usedBytes / Math.max(1, summary.disk.totalBytes)) * 100 : 0;
  // The bar earns the alarm colours only where a full disk is a real prospect.
  const diskColor = diskPct > 90 ? "error.main" : diskPct > 75 ? "warning.main" : "primary.main";

  return (
    <AdminPageShell
      title="Files"
      description={
        <>
          Disk usage of the shared blob folder — baked textures, frames, snapshots and uploads. Mongo&apos;s own
          sizes are on the <MuiLink component={Link} href="/admin/db">Database</MuiLink> page.
        </>
      }
      maxWidth={980}
      actions={
        <Button variant="outlined" onClick={refresh} disabled={loading}>
          {loading ? "Walking…" : "Refresh"}
        </Button>
      }
    >
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {summary && !summary.enabled && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          <Typography variant="body2" component="span" sx={{ fontWeight: 700, color: "warning.main" }}>
            Blob folder disabled.
          </Typography>{" "}
          <code>BLOB_DIR</code> is unset, so bytes are still being stored in Mongo rather than on disk. This is normal
          running outside docker-compose; there is nothing on the filesystem to measure.
        </Alert>
      )}

      {summary?.enabled && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            <code>{summary.root}</code> · walked in <Box component="span" sx={reading}>{summary.tookMs}ms</Box> · as of{" "}
            <Box component="span" sx={reading}>{new Date(summary.at).toLocaleTimeString()}</Box>
          </Typography>

          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 1.5, mt: 2 }}>
            {[
              ["Namespaces", formatCount(namespaces.length)],
              ["Files", formatCount(summary.files ?? 0)],
              ["Blob bytes", formatBytes(summary.bytes ?? 0)],
              ["Disk used", summary.disk ? formatBytes(summary.disk.usedBytes) : "—"],
              ["Disk free", summary.disk ? formatBytes(summary.disk.freeBytes) : "—"],
              ["Disk total", summary.disk ? formatBytes(summary.disk.totalBytes) : "—"],
            ].map(([label, value]) => (
              <Paper key={label} sx={{ p: 1.75 }}>
                <Typography variant="overline" color="text.secondary" component="div">
                  {label}
                </Typography>
                <Typography sx={{ ...reading, fontSize: 18, fontWeight: 600, mt: 0.5 }}>{value}</Typography>
              </Paper>
            ))}
          </Box>

          {summary.disk && (
            <Box sx={{ mt: 2 }}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", mb: 0.75 }}>
                <Typography variant="caption" color="text.secondary">
                  Filesystem holding the blob folder — blobs are {formatBytes(summary.bytes ?? 0)} of the{" "}
                  {formatBytes(summary.disk.usedBytes)} used
                </Typography>
                <Typography variant="caption" sx={{ ...reading, color: diskColor, whiteSpace: "nowrap" }}>
                  {diskPct.toFixed(1)}% full
                </Typography>
              </Stack>
              <Box sx={{ height: 8, borderRadius: 1, bgcolor: surface.raised, overflow: "hidden" }}>
                <Box
                  sx={{
                    height: "100%",
                    width: `${Math.min(100, Math.max(1, diskPct))}%`,
                    bgcolor: diskColor,
                  }}
                />
              </Box>
            </Box>
          )}

          {!!summary.tmpFiles && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {formatCount(summary.tmpFiles)} abandoned temp {summary.tmpFiles === 1 ? "write" : "writes"} holding{" "}
              {formatBytes(summary.tmpBytes ?? 0)} — left behind by writes that crashed mid-flight. Safe to delete;
              they are not counted in the sizes below.
            </Alert>
          )}

          <Table sx={{ mt: 3 }}>
            <TableHead>
              <TableRow>
                <TableCell>{sorted.header("namespace", "Namespace")}</TableCell>
                <TableCell align="right">{sorted.header("files", "Files")}</TableCell>
                <TableCell align="right">{sorted.header("largest", "Largest")}</TableCell>
                <TableCell align="right">{sorted.header("oldest", "Oldest")}</TableCell>
                <TableCell align="right">{sorted.header("newest", "Newest")}</TableCell>
                <TableCell align="right">{sorted.header("size", "Size")}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.rows.map((n) => (
                <TableRow key={n.ns}>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {n.label}
                      </Typography>
                      {/* A directory nothing in BLOB_NAMESPACES claims is a
                          reclaim candidate — call it out rather than hide it. */}
                      {!n.known && <Chip label="unknown" color="warning" />}
                    </Stack>
                    <Typography variant="caption" color="text.disabled" component="div" sx={{ mt: 0.25 }}>
                      <code>{n.ns}/</code> · {n.desc}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={reading}>{formatCount(n.files)}</TableCell>
                  <TableCell align="right" sx={{ ...reading, color: "text.secondary" }}>{formatBytes(n.largestBytes)}</TableCell>
                  <TableCell align="right" sx={{ ...reading, color: "text.secondary" }}>{formatAge(n.oldestMs)}</TableCell>
                  <TableCell align="right" sx={{ ...reading, color: "text.secondary" }}>{formatAge(n.newestMs)}</TableCell>
                  <TableCell align="right" sx={{ ...reading, fontWeight: 600 }}>{formatBytes(n.bytes)}</TableCell>
                  <TableCell sx={{ width: 100 }}>
                    <Box sx={{ height: 6, borderRadius: 0.75, bgcolor: surface.raised }}>
                      <Box
                        sx={{
                          height: "100%",
                          width: `${Math.max(2, (n.bytes / maxSize) * 100)}%`,
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

          {!namespaces.length && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              The blob folder is empty — nothing has been written to it yet.
            </Typography>
          )}

          {!!summary.emptyNamespaces?.length && (
            <Typography variant="caption" color="text.disabled" component="p" sx={{ mt: 1.75 }}>
              Never written: {summary.emptyNamespaces.join(", ")} — these stores have no folder yet.
            </Typography>
          )}
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
