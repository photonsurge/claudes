"use client";

import { useCallback, useEffect, useState } from "react";
import { listShips } from "../../lib/tracks/client";
import type { Ship } from "../../lib/tracks/types";
import { primary, select, th, thNum, td, tdNum, toolbar, asOf } from "./styles";

// [w, s, e, n] regions for the AIS bounding-box subscription.
const REGIONS: { id: string; label: string; bbox: [number, number, number, number] }[] = [
  { id: "channel", label: "Channel & N. Sea", bbox: [-6, 49, 6, 54] },
  { id: "med", label: "W. Mediterranean", bbox: [-6, 35, 16, 44] },
  { id: "singapore", label: "Singapore Strait", bbox: [103, 1, 105, 2] },
  { id: "uswest", label: "US West Coast", bbox: [-126, 32, -117, 49] },
];

export default function ShipsTable() {
  const [region, setRegion] = useState("channel");
  const [rows, setRows] = useState<Ship[]>([]);
  const [at, setAt] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setNote(null);
    try {
      const bbox = REGIONS.find((r) => r.id === region)!.bbox;
      const res = await listShips(bbox);
      setRows(res.ships);
      setAt(res.at ?? null);
      setConfigured(res.configured);
      setNote(res.note ?? res.error ?? null);
    } finally {
      setLoading(false);
    }
  }, [region]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!configured) {
    return (
      <div style={{ padding: 16, border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c" }}>
        <strong>AIS not configured.</strong>
        <p style={{ color: "#8b95a7", fontSize: 13 }}>
          Set <code>AISSTREAM_API_KEY</code> (free at aisstream.io) and restart to stream vessels.
        </p>
        <button type="button" onClick={reload} style={primary}>
          Re-check
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={toolbar}>
        <span style={{ color: "#8b95a7", fontSize: 13 }}>{rows.length} vessels</span>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          Region
          <select value={region} onChange={(e) => setRegion(e.target.value)} style={select}>
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={reload} style={primary} disabled={loading}>
          {loading ? "…" : "Sample"}
        </button>
      </div>
      {note && <div style={{ ...asOf, color: "#fca5a5" }}>{note}</div>}
      {at && <div style={asOf}>~4s sample as of {new Date(at).toUTCString()}</div>}

      <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#8b95a7" }}>
            <th style={th}>Name</th>
            <th style={th}>MMSI</th>
            <th style={thNum}>Lat</th>
            <th style={thNum}>Lon</th>
            <th style={thNum}>SOG (kn)</th>
            <th style={thNum}>COG</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.mmsi} style={{ borderTop: "1px solid #1b2030" }}>
              <td style={td}>{s.name ?? "—"}</td>
              <td style={{ ...td, color: "#8b95a7" }}>{s.mmsi}</td>
              <td style={tdNum}>{s.lat.toFixed(3)}</td>
              <td style={tdNum}>{s.lng.toFixed(3)}</td>
              <td style={tdNum}>{s.sogKn != null ? s.sogKn.toFixed(1) : "—"}</td>
              <td style={tdNum}>{s.cogDeg != null ? `${s.cogDeg.toFixed(0)}°` : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td style={td} colSpan={6}>
                {loading ? "Sampling…" : "No vessels in this sample — try another region."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
