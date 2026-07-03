"use client";

import { useCallback, useEffect, useState } from "react";
import { listAircraft } from "../../lib/tracks/client";
import type { Aircraft } from "../../lib/tracks/types";
import { countryNameFlag } from "@photonsurge/shared/tracks/flags";
import { listNotable, keyFor } from "../../lib/tracks/notable";
import NotableButton from "./NotableButton";
import { primary, select, th, thNum, td, tdNum, toolbar, asOf } from "./styles";

// A few handy regions to scope the (heavy) global feed. [w, s, e, n].
const REGIONS: { id: string; label: string; bbox?: [number, number, number, number] }[] = [
  { id: "eu", label: "Europe", bbox: [-12, 35, 30, 60] },
  { id: "uk", label: "UK & Ireland", bbox: [-11, 49, 2, 61] },
  { id: "us", label: "Continental US", bbox: [-125, 24, -66, 50] },
  { id: "world", label: "World (heavy)" },
];

export default function AircraftTable() {
  const [region, setRegion] = useState("world");
  const [rows, setRows] = useState<Aircraft[]>([]);
  const [at, setAt] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which aircraft are already in the notable catalog (by `${kind}:${code}` id).
  const [notable, setNotable] = useState<Set<string>>(new Set());

  useEffect(() => {
    listNotable().then((list) => setNotable(new Set(list.map((n) => n.id))));
  }, []);
  const setNotableFor = (icao24: string, on: boolean) =>
    setNotable((prev) => {
      const next = new Set(prev);
      const k = keyFor("aircraft", icao24);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const bbox = REGIONS.find((r) => r.id === region)?.bbox;
      // Uncapped — show every aircraft the worker cached (the "of total" count
      // above makes any truncation visible). World = the whole global feed.
      const res = await listAircraft(bbox);
      setRows(res.aircraft);
      setTotal(res.total ?? res.count);
      setAt(res.at);
      if (res.error) setError(res.error);
    } finally {
      setLoading(false);
    }
  }, [region]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div>
      <div style={toolbar}>
        <span style={{ color: "#8b95a7", fontSize: 13 }}>
          {rows.length}
          {total > rows.length ? ` of ${total}` : ""} aircraft
        </span>
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
          {loading ? "…" : "Refresh"}
        </button>
      </div>
      {error && <div style={{ ...asOf, color: "#fca5a5" }}>Aircraft feed: {error} (try another region)</div>}
      {at && !error && <div style={asOf}>as of {new Date(at).toUTCString()}</div>}

      <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#8b95a7" }}>
            <th style={th}>Callsign</th>
            <th style={th}>ICAO24</th>
            <th style={th}>Reg</th>
            <th style={th}>Type</th>
            <th style={th}>Country</th>
            <th style={thNum}>Lat</th>
            <th style={thNum}>Lon</th>
            <th style={thNum}>Alt (m)</th>
            <th style={thNum}>Speed (m/s)</th>
            <th style={thNum}>Track</th>
            <th style={th}>Notable</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.icao24} style={{ borderTop: "1px solid #1b2030" }}>
              <td style={td}>{a.callsign ?? "—"}</td>
              <td style={{ ...td, color: "#8b95a7" }}>{a.icao24}</td>
              <td style={td}>{a.registration ?? "—"}</td>
              <td style={{ ...td, color: "#8b95a7" }}>{a.acType ?? "—"}</td>
              <td style={td}>{a.country ? `${countryNameFlag(a.country)} ${a.country}`.trim() : ""}</td>
              <td style={tdNum}>{a.lat.toFixed(2)}</td>
              <td style={tdNum}>{a.lng.toFixed(2)}</td>
              <td style={tdNum}>{a.altM != null ? a.altM.toFixed(0) : "—"}</td>
              <td style={tdNum}>{a.velocityMS != null ? a.velocityMS.toFixed(0) : "—"}</td>
              <td style={tdNum}>{a.headingDeg != null ? `${a.headingDeg.toFixed(0)}°` : "—"}</td>
              <td style={td}>
                <NotableButton
                  kind="aircraft"
                  code={a.icao24}
                  label={a.callsign ?? undefined}
                  isNotable={notable.has(keyFor("aircraft", a.icao24))}
                  onChange={(on) => setNotableFor(a.icao24, on)}
                />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td style={td} colSpan={11}>
                {loading ? "Loading…" : "No aircraft — try another region or refresh."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
