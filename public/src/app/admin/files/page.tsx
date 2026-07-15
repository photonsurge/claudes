"use client";

/**
 * /admin/files — the shared ${BLOB_DIR} blob folder: what each namespace is
 * storing, how much disk is left, and any leftover temp writes. Read-only info
 * page, no operator actions. The filesystem-side sibling of /admin/db.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { useTableSort } from "../../../components/admin/useTableSort";

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

  return (
    <AdminPageShell
      title="Files"
      description={
        <>
          Disk usage of the shared blob folder — baked textures, frames, snapshots and uploads. Mongo&apos;s own
          sizes are on the <Link href="/admin/db" style={{ color: "#60a5fa" }}>Database</Link> page.
        </>
      }
      maxWidth={980}
      actions={
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #333",
            background: "#151b28",
            color: "#cdd4e0",
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.6 : 1,
            fontSize: 12,
          }}
        >
          {loading ? "Walking…" : "Refresh"}
        </button>
      }
    >
      {error && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 8, border: "1px solid #7f1d1d", background: "#1a0f0f", color: "#fca5a5", fontSize: 13 }}>
          {error}
        </div>
      )}

      {summary && !summary.enabled && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 8, border: "1px solid #2a3344", background: "#0c111c", color: "#8b95a7", fontSize: 13, lineHeight: 1.5 }}>
          <strong style={{ color: "#fbbf24" }}>Blob folder disabled.</strong> <code>BLOB_DIR</code> is unset, so bytes
          are still being stored in Mongo rather than on disk. This is normal running outside docker-compose; there is
          nothing on the filesystem to measure.
        </div>
      )}

      {summary?.enabled && (
        <>
          <div style={{ color: "#8b95a7", fontSize: 13, marginTop: 4 }}>
            <code>{summary.root}</code> · walked in {summary.tookMs}ms · as of {new Date(summary.at).toLocaleTimeString()}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 16 }}>
            {[
              ["Namespaces", formatCount(namespaces.length)],
              ["Files", formatCount(summary.files ?? 0)],
              ["Blob bytes", formatBytes(summary.bytes ?? 0)],
              ["Disk used", summary.disk ? formatBytes(summary.disk.usedBytes) : "—"],
              ["Disk free", summary.disk ? formatBytes(summary.disk.freeBytes) : "—"],
              ["Disk total", summary.disk ? formatBytes(summary.disk.totalBytes) : "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: 14, borderRadius: 8, border: "1px solid #1b2030", background: "#0c111c" }}>
                <div style={{ color: "#8b95a7", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{value}</div>
              </div>
            ))}
          </div>

          {summary.disk && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#8b95a7", fontSize: 12, marginBottom: 6 }}>
                <span>
                  Filesystem holding the blob folder — blobs are {formatBytes(summary.bytes ?? 0)} of the{" "}
                  {formatBytes(summary.disk.usedBytes)} used
                </span>
                <span style={{ color: diskPct > 90 ? "#fca5a5" : diskPct > 75 ? "#fbbf24" : "#8b95a7" }}>
                  {diskPct.toFixed(1)}% full
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "#151b28", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, Math.max(1, diskPct))}%`,
                    background: diskPct > 90 ? "#dc2626" : diskPct > 75 ? "#d97706" : "#2563eb",
                  }}
                />
              </div>
            </div>
          )}

          {!!summary.tmpFiles && (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 8, border: "1px solid #78350f", background: "#170f05", color: "#fbbf24", fontSize: 13 }}>
              {formatCount(summary.tmpFiles)} abandoned temp {summary.tmpFiles === 1 ? "write" : "writes"} holding{" "}
              {formatBytes(summary.tmpBytes ?? 0)} — left behind by writes that crashed mid-flight. Safe to delete;
              they are not counted in the sizes below.
            </div>
          )}

          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 24, fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#8b95a7", borderBottom: "1px solid #1b2030" }}>
                <th style={{ padding: "6px 8px" }}>{sorted.header("namespace", "Namespace")}</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>{sorted.header("files", "Files")}</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>{sorted.header("largest", "Largest")}</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>{sorted.header("oldest", "Oldest")}</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>{sorted.header("newest", "Newest")}</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>{sorted.header("size", "Size")}</th>
                <th style={{ padding: "6px 8px" }} />
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((n) => (
                <tr key={n.ns} style={{ borderBottom: "1px solid #12161f" }}>
                  <td style={{ padding: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{n.label}</span>
                      {!n.known && (
                        <span style={{ fontSize: 11, color: "#fbbf24", border: "1px solid #78350f", borderRadius: 4, padding: "1px 5px" }}>
                          unknown
                        </span>
                      )}
                    </div>
                    <div style={{ color: "#5b6577", fontSize: 12, marginTop: 2 }}>
                      <code>{n.ns}/</code> · {n.desc}
                    </div>
                  </td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatCount(n.files)}</td>
                  <td style={{ padding: "8px", textAlign: "right", color: "#8b95a7" }}>{formatBytes(n.largestBytes)}</td>
                  <td style={{ padding: "8px", textAlign: "right", color: "#8b95a7" }}>{formatAge(n.oldestMs)}</td>
                  <td style={{ padding: "8px", textAlign: "right", color: "#8b95a7" }}>{formatAge(n.newestMs)}</td>
                  <td style={{ padding: "8px", textAlign: "right", fontWeight: 600 }}>{formatBytes(n.bytes)}</td>
                  <td style={{ padding: "8px", width: 100 }}>
                    <div style={{ height: 6, borderRadius: 3, background: "#151b28" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.max(2, (n.bytes / maxSize) * 100)}%`,
                          borderRadius: 3,
                          background: "#2563eb",
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!namespaces.length && (
            <div style={{ color: "#8b95a7", marginTop: 16, fontSize: 13 }}>
              The blob folder is empty — nothing has been written to it yet.
            </div>
          )}

          {!!summary.emptyNamespaces?.length && (
            <div style={{ color: "#5b6577", fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>
              Never written: {summary.emptyNamespaces.join(", ")} — these stores have no folder yet.
            </div>
          )}
        </>
      )}

      {!summary && !error && <div style={{ color: "#8b95a7", marginTop: 16 }}>Loading…</div>}
    </AdminPageShell>
  );
}
