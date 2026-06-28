"use client";

import { useCallback, useEffect, useState } from "react";
import { SATELLITE_GROUPS, DEFAULT_SATELLITE_GROUP } from "../../lib/tracks/celestrak";
import { listSatellites } from "../../lib/tracks/client";
import type { SatellitePosition } from "../../lib/tracks/types";
import { primary, select, th, thNum, td, tdNum, toolbar, asOf } from "./styles";

export default function SatellitesTable() {
  const [group, setGroup] = useState(DEFAULT_SATELLITE_GROUP);
  const [sats, setSats] = useState<SatellitePosition[]>([]);
  const [at, setAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSatellites(group, 3000);
      setSats(res.satellites);
      setAt(res.at);
    } finally {
      setLoading(false);
    }
  }, [group]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div>
      <div style={toolbar}>
        <span style={{ color: "#8b95a7", fontSize: 13 }}>{sats.length} satellites</span>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          Group
          <select value={group} onChange={(e) => setGroup(e.target.value)} style={select}>
            {SATELLITE_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={reload} style={primary} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>
      {at && <div style={asOf}>positions as of {new Date(at).toUTCString()}</div>}

      <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#8b95a7" }}>
            <th style={th}>Name</th>
            <th style={th}>NORAD</th>
            <th style={thNum}>Lat</th>
            <th style={thNum}>Lon</th>
            <th style={thNum}>Alt (km)</th>
            <th style={thNum}>Speed (km/s)</th>
          </tr>
        </thead>
        <tbody>
          {sats.map((s) => (
            <tr key={s.noradId} style={{ borderTop: "1px solid #1b2030" }}>
              <td style={td}>{s.name}</td>
              <td style={{ ...td, color: "#8b95a7" }}>{s.noradId}</td>
              <td style={tdNum}>{s.lat.toFixed(2)}</td>
              <td style={tdNum}>{s.lng.toFixed(2)}</td>
              <td style={tdNum}>{s.altKm.toFixed(0)}</td>
              <td style={tdNum}>{s.speedKmS.toFixed(2)}</td>
            </tr>
          ))}
          {sats.length === 0 && (
            <tr>
              <td style={td} colSpan={6}>
                {loading ? "Loading…" : "No satellites — try another group or refresh."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
