"use client";

/**
 * Admin ad list: filter by status / text, upload ads, click a row to preview +
 * edit it, toggle active/inactive, or delete. Reads/writes /api/admin/ads.
 * Display + scheduling on the broadcast come in a later phase — this is the
 * catalog surface.
 */
import { useCallback, useEffect, useState } from "react";
import { listAds, setAdStatus, deleteAd, getAdExposureTotals, type AdExposureTotal } from "../../lib/ads/client";
import { AD_PLACEMENT_LABELS } from "../../lib/ads/types";
import type { Ad, AdStatus } from "../../lib/ads/types";
import { primary, select, th, thNum, td, tdNum, toolbar, asOf } from "../tracks/styles";
import AdViewer from "./AdViewer";
import AddAdForm from "./AddAdForm";
import AdEditPanel from "./AdEditPanel";
import AdExposureLog, { fmtWindowMs } from "./AdExposureLog";
import { useTableSort } from "../admin/useTableSort";

const STATUS_FILTERS: { id: "" | AdStatus; label: string }[] = [
  { id: "", label: "All" },
  { id: "active", label: "Active" },
  { id: "inactive", label: "Inactive" },
];

const STATUS_COLOR: Record<AdStatus, string> = {
  active: "#34d399",
  inactive: "#8b95a7",
};

const NEXT_STATUS: Record<AdStatus, AdStatus> = {
  active: "inactive",
  inactive: "active",
};

const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/** Absolute date + time an ad last aired (or "—" if never). */
const fmtLastShown = (ms?: number): string =>
  ms
    ? new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/** Cumulative on-screen time across every airing, e.g. "3m 20s". */
const fmtDuration = (ms?: number): string => {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

export default function AdsTable() {
  const [rows, setRows] = useState<Ad[]>([]);
  const [status, setStatus] = useState<"" | AdStatus>("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Ad | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Worker-written ticker-exposure rollup (cumulative crawl time + live-now
  // scenes per ad) — fetched alongside the list, keyed by adId.
  const [exposure, setExposure] = useState<Record<string, AdExposureTotal>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    setNote(null);
    const [res, totals] = await Promise.all([
      listAds({ status: status || undefined, q: q.trim() || undefined }),
      getAdExposureTotals(),
    ]);
    setRows(res.ads);
    setExposure(totals);
    if (res.error) setNote(res.error);
    setLoading(false);
  }, [status, q]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Keep the open preview in sync with refreshed data (status/meta edits).
  useEffect(() => {
    if (!selected) return;
    const fresh = rows.find((r) => r.adId === selected.adId);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [rows, selected]);

  const upsertRow = (ad: Ad) => {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.adId === ad.adId);
      if (i === -1) return [ad, ...prev];
      const next = [...prev];
      next[i] = ad;
      return next;
    });
    setSelected(ad);
  };

  const onToggle = async (ad: Ad) => {
    const res = await setAdStatus(ad.adId, NEXT_STATUS[ad.status]);
    if (res.ad) setRows((prev) => prev.map((r) => (r.adId === ad.adId ? res.ad! : r)));
  };

  const onDelete = async (ad: Ad) => {
    const res = await deleteAd(ad.adId);
    if (res.ok) {
      setRows((prev) => prev.filter((r) => r.adId !== ad.adId));
      setSelected((s) => (s?.adId === ad.adId ? null : s));
    } else {
      setNote(res.error ?? "delete failed");
    }
  };
  const sorted = useTableSort(rows, { title: (a) => a.title, advertiser: (a) => a.advertiser, type: (a) => a.mediaType,
    runs: (a) => (a.placements ?? []).join(","), size: (a) => a.byteSize, weight: (a) => a.weight,
    shown: (a) => a.lastShownAt, screen: (a) => a.totalDisplayMs,
    ticker: (a) => exposure[a.adId]?.ms ?? 0, status: (a) => a.status }, "title");

  return (
    <div>
      <div style={{ ...toolbar, justifyContent: "space-between", marginBottom: 12 }}>
        <AddAdForm onSaved={upsertRow} />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title / advertiser"
            style={{ ...select, minWidth: 180 }}
          />
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as "" | AdStatus)} style={select}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={reload} style={primary} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {note && <div style={{ ...asOf, color: "#fca5a5" }}>{note}</div>}
      <div style={asOf}>{rows.length} ads</div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "minmax(0, 1.4fr) minmax(280px, 1fr)" : "1fr", gap: 16, marginTop: 8 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#8b95a7" }}>
                <th style={th}>{sorted.header("title", "Title")}</th><th style={th}>{sorted.header("advertiser", "Advertiser")}</th>
                <th style={th}>{sorted.header("type", "Type")}</th><th style={th}>{sorted.header("runs", "Runs in")}</th>
                <th style={thNum}>{sorted.header("size", "Size")}</th>
                <th style={thNum}>{sorted.header("weight", "Weight")}</th><th style={th}>{sorted.header("shown", "Last shown")}</th>
                <th style={th}>{sorted.header("screen", "On screen")}</th><th style={th}>{sorted.header("ticker", "Ticker time")}</th>
                <th style={th}>{sorted.header("status", "Status")}</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((a) => {
                const isSel = selected?.adId === a.adId;
                return (
                  <tr
                    key={a.adId}
                    onClick={() => setSelected(a)}
                    style={{ borderTop: "1px solid #1b2030", cursor: "pointer", background: isSel ? "#13192a" : undefined }}
                  >
                    <td style={td}>{a.title}</td>
                    <td style={{ ...td, color: "#8b95a7" }}>{a.advertiser ?? "—"}</td>
                    <td style={{ ...td, color: "#8b95a7" }}>{a.mediaType}</td>
                    <td style={{ ...td, color: "#8b95a7", whiteSpace: "nowrap" }}>
                      {(a.placements ?? ["break"]).map((p) => AD_PLACEMENT_LABELS[p]).join(" · ")}
                    </td>
                    <td style={tdNum}>{fmtBytes(a.byteSize)}</td>
                    <td style={tdNum}>{a.weight}</td>
                    <td style={{ ...td, color: "#8b95a7", whiteSpace: "nowrap" }} title={a.timesShown ? `${a.timesShown}× total` : "never aired"}>
                      {fmtLastShown(a.lastShownAt)}
                    </td>
                    <td style={{ ...td, color: "#8b95a7", whiteSpace: "nowrap" }} title="cumulative time actually on screen">
                      {fmtDuration(a.totalDisplayMs)}
                    </td>
                    <td
                      style={{ ...td, color: "#8b95a7", whiteSpace: "nowrap" }}
                      title={
                        exposure[a.adId]?.liveScenes.length
                          ? `in the crawl now on: ${exposure[a.adId].liveScenes.map((s) => s.name).join(", ")}`
                          : "cumulative time the Sponsored-by mention has been in the crawl"
                      }
                    >
                      {exposure[a.adId] ? fmtWindowMs(exposure[a.adId].ms) : "—"}
                      {exposure[a.adId]?.liveScenes.length ? (
                        <span style={{ color: "#34d399", marginLeft: 6, fontSize: 11, fontWeight: 700 }}>● LIVE</span>
                      ) : null}
                    </td>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onToggle(a); }}
                        title="Toggle status"
                        style={{ background: "none", border: "none", color: STATUS_COLOR[a.status], cursor: "pointer", fontSize: 13, padding: 0 }}
                      >
                        ● {a.status}
                      </button>
                    </td>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDelete(a); }}
                        style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 13 }}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td style={td} colSpan={11}>
                    {loading ? "Loading…" : "No ads yet — add one above."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <div style={{ border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c", padding: 12, height: "fit-content" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontSize: 14 }}>{selected.title}</strong>
              <button type="button" onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#8b95a7", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
            <AdViewer ad={selected} />
            <div style={{ ...asOf, marginTop: 8 }}>
              {selected.contentType} · {fmtBytes(selected.byteSize)}
              {selected.clickUrl ? (
                <>
                  {" · "}
                  <a href={selected.clickUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>
                    link ↗
                  </a>
                </>
              ) : null}
            </div>
            <AdEditPanel ad={selected} onSaved={upsertRow} />
            <AdExposureLog adId={selected.adId} />
          </div>
        )}
      </div>
    </div>
  );
}
