"use client";

/**
 * Admin volcano list: filter by status / name, click a row to preview its
 * Wikipedia photo/blurb, trigger a manual refresh or enrichment run. Reads the
 * same worker-cached feed the globe overlay does (`useVolcanoes`) — small
 * dataset (dozens), so filtering/sorting happens client-side, no server
 * pagination like the cities table needs.
 */
import { useEffect, useMemo, useState } from "react";
import { useVolcanoes } from "../../lib/volcanoes-overlay";
import type { Volcano, VolcanoStatus } from "@photonsurge/shared/volcanoes/types";
import { primary, select, th, thNum, td, tdNum, toolbar, asOf } from "../tracks/styles";

const STATUS_FILTERS: { id: "" | VolcanoStatus; label: string }[] = [
  { id: "", label: "All" },
  { id: "erupting", label: "Erupting" },
  { id: "unrest", label: "Unrest" },
  { id: "dormant", label: "Dormant" },
];

const STATUS_COLOR: Record<VolcanoStatus, string> = {
  erupting: "#ef4444",
  unrest: "#f97316",
  dormant: "#94a3b8",
};

const STATUS_LABEL: Record<VolcanoStatus, string> = {
  erupting: "Erupting",
  unrest: "Unrest",
  dormant: "Dormant",
};

function wikiStatus(v: Volcano): { label: string; color: string } {
  if (v.wikiTitle || v.wikiThumb || v.wikiExtract) return { label: "Enriched", color: "#34d399" };
  if (v.wikiFetchedAt) return { label: "Checked — no match", color: "#fbbf24" };
  return { label: "Not enriched", color: "#8b95a7" };
}

function formatDate(ms?: number): string {
  return ms ? new Date(ms).toLocaleString() : "—";
}

async function runJob(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/admin/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: !!body.ok, error: body.error };
}

export default function VolcanoesTable() {
  const volcanoes = useVolcanoes(true);
  const [status, setStatus] = useState<"" | VolcanoStatus>("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Volcano | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      volcanoes
        .filter((v) => (status ? v.status === status : true))
        .filter((v) => (q.trim() ? v.name.toLowerCase().includes(q.trim().toLowerCase()) : true))
        .sort((a, b) => b.lastDate - a.lastDate),
    [volcanoes, status, q],
  );

  // Keep the open detail panel in sync as the feed refreshes (e.g. after enrichment lands).
  useEffect(() => {
    if (!selected) return;
    const fresh = volcanoes.find((v) => v.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [volcanoes, selected]);

  const trigger = async (id: string, label: string) => {
    setBusy(id);
    setNote(null);
    const res = await runJob(id);
    setNote(res.ok ? `${label} queued.` : `${label} failed: ${res.error}`);
    setBusy(null);
  };

  return (
    <div>
      <div style={{ ...toolbar, justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => trigger("volcanoes-snapshot", "Refresh")}
            style={primary}
            disabled={busy === "volcanoes-snapshot"}
          >
            {busy === "volcanoes-snapshot" ? "…" : "Refresh now"}
          </button>
          <button
            type="button"
            onClick={() => trigger("volcanoes-enrich", "Enrich")}
            style={primary}
            disabled={busy === "volcanoes-enrich"}
          >
            {busy === "volcanoes-enrich" ? "…" : "Enrich all (Wikipedia)"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name"
            style={{ ...select, minWidth: 180 }}
          />
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as "" | VolcanoStatus)} style={select}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.id || "all"} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {note && <div style={asOf}>{note}</div>}
      <div style={asOf}>
        {rows.length} of {volcanoes.length} volcanoes
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: selected ? "minmax(0, 1.4fr) minmax(280px, 1fr)" : "1fr",
          gap: 16,
          marginTop: 8,
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#8b95a7" }}>
                <th style={th}>Name</th>
                <th style={th}>Country</th>
                <th style={th}>Status</th>
                <th style={th}>Last update</th>
                <th style={th}>Wiki</th>
                <th style={thNum}>Lat</th>
                <th style={thNum}>Lng</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const wiki = wikiStatus(v);
                const isSel = selected?.id === v.id;
                return (
                  <tr
                    key={v.id}
                    onClick={() => setSelected(v)}
                    style={{ borderTop: "1px solid #1b2030", cursor: "pointer", background: isSel ? "#13192a" : undefined }}
                  >
                    <td style={td}>{v.name}</td>
                    <td style={{ ...td, color: "#8b95a7" }}>{v.country ?? "—"}</td>
                    <td style={{ ...td, color: STATUS_COLOR[v.status] }}>● {STATUS_LABEL[v.status]}</td>
                    <td style={{ ...td, color: "#8b95a7" }}>{formatDate(v.lastDate)}</td>
                    <td style={{ ...td, color: wiki.color }}>{wiki.label}</td>
                    <td style={tdNum}>{v.lat.toFixed(3)}</td>
                    <td style={tdNum}>{v.lng.toFixed(3)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td style={td} colSpan={7}>
                    {volcanoes.length === 0 ? "No active volcanoes cached yet — hit Refresh now." : "No matches."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <div style={{ border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c", padding: 12, height: "fit-content" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontSize: 14 }}>{selected.name}</strong>
              <button
                type="button"
                onClick={() => setSelected(null)}
                style={{ background: "none", border: "none", color: "#8b95a7", cursor: "pointer", fontSize: 16 }}
              >
                ×
              </button>
            </div>
            {selected.wikiThumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.wikiThumb}
                alt=""
                style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 6, background: "#080b11" }}
              />
            )}
            <div style={{ ...asOf, marginTop: 8, color: STATUS_COLOR[selected.status] }}>
              ● {STATUS_LABEL[selected.status]}
              {selected.country ? ` · ${selected.country}` : ""}
            </div>
            <div style={asOf}>
              This week's report{selected.reportDateRange ? ` (${selected.reportDateRange})` : ""}: {formatDate(selected.lastDate)}
            </div>
            <div style={asOf}>Tracked here since: {formatDate(selected.firstDate)}</div>
            {selected.latestReport && (
              <div style={{ marginTop: 10 }}>
                <div style={{ ...asOf, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10 }}>Latest bulletin</div>
                <p style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.45, margin: "4px 0 0" }}>{selected.latestReport}</p>
              </div>
            )}
            {selected.wikiExtract && (
              <div style={{ marginTop: 10 }}>
                <div style={{ ...asOf, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10 }}>About</div>
                <p style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.45, margin: "4px 0 0" }}>{selected.wikiExtract}</p>
              </div>
            )}
            {selected.wikiTitle && (
              <a
                href={`https://en.wikipedia.org/wiki/${encodeURIComponent(selected.wikiTitle.replace(/ /g, "_"))}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#60a5fa", fontSize: 12, display: "inline-block", marginTop: 8 }}
              >
                Open Wikipedia ↗
              </a>
            )}
            {selected.sourceUrl && (
              <a
                href={selected.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{ ...asOf, color: "#60a5fa", display: "block", marginTop: 4 }}
              >
                Source report ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
