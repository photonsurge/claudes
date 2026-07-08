"use client";

/**
 * /admin/db — Mongo database summary: total size, per-collection doc counts
 * and storage/index sizes. Read-only info page, no operator actions.
 */
import { useCallback, useEffect, useState } from "react";
import AdminPageShell from "../../../components/admin/AdminPageShell";

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

  return (
    <AdminPageShell
      title="Database"
      description="Mongo collection sizes, document counts and storage summary."
      maxWidth={980}
      actions={
        <button
          type="button"
          onClick={refresh}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #333",
            background: "#151b28",
            color: "#cdd4e0",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Refresh
        </button>
      }
    >

      {error && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 8, border: "1px solid #7f1d1d", background: "#1a0f0f", color: "#fca5a5", fontSize: 13 }}>
          {error}
        </div>
      )}

      {summary && (
        <>
          <div style={{ color: "#8b95a7", fontSize: 13, marginTop: 4 }}>
            {summary.db} · as of {new Date(summary.at).toLocaleTimeString()}
          </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 16 }}>
              {[
                ["Collections", formatCount(summary.dbStats.collections)],
                ["Documents", formatCount(summary.dbStats.objects)],
                ["Data size", formatBytes(summary.dbStats.dataSize)],
                ["Storage size", formatBytes(summary.dbStats.storageSize)],
                ["Index size", formatBytes(summary.dbStats.indexSize)],
                ["Total on disk", formatBytes(summary.dbStats.totalSize)],
              ].map(([label, value]) => (
                <div key={label} style={{ padding: 14, borderRadius: 8, border: "1px solid #1b2030", background: "#0c111c" }}>
                  <div style={{ color: "#8b95a7", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{value}</div>
                </div>
              ))}
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 24, fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#8b95a7", borderBottom: "1px solid #1b2030" }}>
                  <th style={{ padding: "6px 8px" }}>Collection</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Docs</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Avg doc</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Data</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Storage</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Indexes</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Total</th>
                  <th style={{ padding: "6px 8px" }} />
                </tr>
              </thead>
              <tbody>
                {summary.collections.map((c) => (
                  <tr key={c.name} style={{ borderBottom: "1px solid #12161f" }}>
                    <td style={{ padding: "8px" }}>{c.name}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{formatCount(c.count)}</td>
                    <td style={{ padding: "8px", textAlign: "right", color: "#8b95a7" }}>{formatBytes(c.avgObjSize)}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{formatBytes(c.dataSize)}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{formatBytes(c.storageSize)}</td>
                    <td style={{ padding: "8px", textAlign: "right", color: "#8b95a7" }}>
                      {formatBytes(c.indexSize)} ({c.indexCount})
                    </td>
                    <td style={{ padding: "8px", textAlign: "right", fontWeight: 600 }}>{formatBytes(c.totalSize)}</td>
                    <td style={{ padding: "8px", width: 100 }}>
                      <div style={{ height: 6, borderRadius: 3, background: "#151b28" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.max(2, (c.totalSize / maxSize) * 100)}%`,
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
        </>
      )}

      {!summary && !error && <div style={{ color: "#8b95a7", marginTop: 16 }}>Loading…</div>}
    </AdminPageShell>
  );
}
