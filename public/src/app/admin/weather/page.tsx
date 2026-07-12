"use client";

/* eslint-disable @next/next/no-img-element */
/**
 * /admin/weather — diagnostic view of the baked weather runs per model. Shows
 * which variables actually baked, how many forecast hours, and WHEN (so a
 * starved/partial ingest — e.g. only temp/humidity present, or a run "baked 2d
 * ago" — is obvious). The newest run per model shows raw-data texture
 * thumbnails; older runs collapse to a one-line summary.
 */
import { useCallback, useEffect, useState } from "react";
import AdminPageShell from "../../../components/admin/AdminPageShell";

interface VarInfo {
  id: string;
  encoding: string;
  units: string;
  fhrCount: number;
  firstFhr: number | null;
  lastFhr: number | null;
  thumbTexId: string | null;
}
interface RunInfo {
  id: string;
  model: string;
  run: string;
  generatedAt: string | null;
  ageMs: number | null;
  status: string;
  published: boolean;
  grid: { width: number; height: number; res: number } | null;
  variableCount: number;
  textureCount: number;
  variables: VarInfo[];
}

const POLL_MS = 20_000;
const texUrl = (id: string) => `/api/weather/tex/${id}.png`;

const fmtTime = (iso?: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};
const fmtAge = (ms: number | null): string => {
  if (ms == null) return "never";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export default function WeatherRunsPage() {
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/weather", { cache: "no-store" });
      const body = await res.json();
      setRuns(Array.isArray(body?.runs) ? body.runs : []);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  const byModel = new Map<string, RunInfo[]>();
  for (const r of runs) {
    const a = byModel.get(r.model) ?? [];
    a.push(r);
    byModel.set(r.model, a);
  }
  // gfs first (it's the base + the one that's been troublesome), then alpha.
  const models = [...byModel.keys()].sort((a, b) =>
    a === "gfs" ? -1 : b === "gfs" ? 1 : a.localeCompare(b),
  );

  return (
    <AdminPageShell
      title="Weather runs"
      description="Every baked weather run per model — which variables actually baked, how many forecast hours, and when. The newest run per model shows raw-data texture thumbnails (not palette-coloured — just to confirm a field baked)."
      actions={
        <button type="button" onClick={reload} style={primary}>
          Refresh
        </button>
      }
      maxWidth={1280}
    >
      {err && <div style={{ color: "#f87171", marginBottom: 12 }}>Failed to load: {err}</div>}
      {runs.length === 0 && (
        <div style={{ color: "#8b95a7" }}>{loading ? "Loading…" : "No weather runs in the database yet."}</div>
      )}

      {models.map((model) => {
        const list = byModel.get(model)!;
        return (
          <section key={model} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>
              {model} <span style={{ color: "#5b6478", fontWeight: 400 }}>· {list.length} run(s)</span>
            </h2>

            {list.map((r, i) => (
              <div key={r.id} style={card}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700 }}>{fmtTime(r.run)}</span>
                  <StatusBadge status={r.status} published={r.published} />
                  <span style={meta}>baked {fmtAge(r.ageMs)}</span>
                  {r.generatedAt && <span style={meta}>({fmtTime(r.generatedAt)})</span>}
                  {r.grid && (
                    <span style={meta}>
                      {r.grid.width}×{r.grid.height}
                    </span>
                  )}
                  <span style={{ ...meta, color: r.variableCount ? "#8b95a7" : "#f87171" }}>
                    {r.variableCount} vars · {r.textureCount} textures
                  </span>
                </div>

                {/* Only the newest run per model renders thumbnails (keeps it fast). */}
                {i === 0 ? (
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                    {r.variables.map((v) => (
                      <div key={v.id} style={{ width: 122 }}>
                        {v.thumbTexId ? (
                          <img
                            src={texUrl(v.thumbTexId)}
                            alt={`${r.model} ${v.id}`}
                            width={122}
                            height={61}
                            style={thumb}
                            loading="lazy"
                          />
                        ) : (
                          <div style={{ ...thumb, ...thumbEmpty }}>no texture</div>
                        )}
                        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{v.id}</div>
                        <div style={{ fontSize: 11, color: "#8b95a7" }}>
                          {v.encoding} · {v.fhrCount} fhr
                          {v.firstFhr != null && v.lastFhr != null ? ` (f${v.firstFhr}–f${v.lastFhr})` : ""}
                        </div>
                      </div>
                    ))}
                    {r.variables.length === 0 && (
                      <span style={{ color: "#f87171", fontSize: 13 }}>no variables baked in this run</span>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#8b95a7" }}>
                    {r.variables.map((v) => v.id).join(", ") || "—"}
                  </div>
                )}
              </div>
            ))}
          </section>
        );
      })}
    </AdminPageShell>
  );
}

function StatusBadge({ status, published }: { status: string; published: boolean }) {
  // A "pending" run that is already published is BAKING LIVE — its maps are going
  // on air field-by-field (progressive publish) while the rest still bake.
  const color =
    status === "complete"
      ? published
        ? "#34d399"
        : "#fbbf24"
      : status === "failed"
        ? "#f87171"
        : published
          ? "#38bdf8"
          : "#8b95a7";
  const label =
    status === "complete"
      ? published
        ? "published"
        : "complete · unpublished"
      : status === "pending"
        ? published
          ? "baking · live"
          : "baking…"
        : status;
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}55`,
        borderRadius: 10,
        padding: "1px 8px",
        fontSize: 11,
        fontWeight: 700,
        background: "#0c111c",
      }}
    >
      {label}
    </span>
  );
}

const primary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
const card: React.CSSProperties = {
  border: "1px solid #1b2030",
  borderRadius: 8,
  padding: "12px 14px",
  marginBottom: 10,
  background: "#0c111c",
};
const meta: React.CSSProperties = { fontSize: 12, color: "#8b95a7", whiteSpace: "nowrap" };
const thumb: React.CSSProperties = {
  width: 122,
  height: 61,
  objectFit: "cover",
  borderRadius: 4,
  border: "1px solid #1b2030",
  background: "#060910",
  display: "block",
};
const thumbEmpty: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#5b6478",
  fontSize: 10,
};
