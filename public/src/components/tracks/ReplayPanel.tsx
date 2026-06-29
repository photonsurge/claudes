"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listHistoryBatches,
  listHistoryAt,
  type SnapshotRow,
  type SnapshotKind,
} from "../../lib/tracks/client";
import { primary, select, th, thNum, td, tdNum, toolbar, asOf } from "./styles";

type KindFilter = "all" | SnapshotKind;

/**
 * Replay of recorded aircraft/ship history. Loads the available frames
 * (batchAt) in a window, then scrubs/plays through them — the table updates to
 * each frame's positions. Frames are ordered oldest→newest so play moves forward
 * in time.
 */
export default function ReplayPanel() {
  const [hours, setHours] = useState(6);
  const [kind, setKind] = useState<KindFilter>("all");
  const [frames, setFrames] = useState<string[]>([]); // chronological
  const [idx, setIdx] = useState(0);
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const kindParam = kind === "all" ? undefined : kind;

  // Load frames when window/kind changes.
  const loadFrames = useCallback(async () => {
    const batches = await listHistoryBatches(hours, kindParam);
    const chrono = batches.slice().reverse(); // API returns newest-first
    setFrames(chrono);
    setIdx(chrono.length ? chrono.length - 1 : 0); // start at most recent
  }, [hours, kindParam]);

  useEffect(() => {
    loadFrames();
  }, [loadFrames]);

  // Load the selected frame's rows.
  useEffect(() => {
    const at = frames[idx];
    if (!at) {
      setRows([]);
      return;
    }
    let cancelled = false;
    listHistoryAt(at, kindParam).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [frames, idx, kindParam]);

  // Play: advance one frame/sec, stop at the end.
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setIdx((i) => {
        if (i >= frames.length - 1) return i; // hold at latest
        return i + 1;
      });
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, frames.length]);

  const at = frames[idx];

  return (
    <div>
      <div style={toolbar}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          Window
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} style={select}>
            {[1, 3, 6, 12, 24, 72].map((h) => (
              <option key={h} value={h}>
                {h}h
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} style={select}>
            <option value="all">All</option>
            <option value="aircraft">Aircraft</option>
            <option value="ship">Ships</option>
          </select>
        </label>
        <button type="button" onClick={loadFrames} style={primary}>
          Reload
        </button>
      </div>

      {frames.length === 0 ? (
        <div style={{ ...asOf, marginTop: 12 }}>
          No recorded history yet. Enable snapshots (worker <code>TRACK_SNAPSHOTS_ENABLED=true</code>)
          or run <code>yarn snapshot:tracks</code>.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              style={{ ...primary, width: 44 }}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "⏸" : "▶"}
            </button>
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              value={idx}
              onChange={(e) => {
                setPlaying(false);
                setIdx(Number(e.target.value));
              }}
              aria-label="Replay frame"
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 12, color: "#8b95a7", width: 70, textAlign: "right" }}>
              {idx + 1}/{frames.length}
            </span>
          </div>
          <div style={asOf}>
            frame {at ? new Date(at).toUTCString() : "—"} · {rows.length} tracks
          </div>

          <table style={{ width: "100%", marginTop: 10, borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#8b95a7" }}>
                <th style={th}>Kind</th>
                <th style={th}>Name</th>
                <th style={th}>Id</th>
                <th style={thNum}>Lat</th>
                <th style={thNum}>Lon</th>
                <th style={thNum}>Alt/Spd</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}:${r.externalId}`} style={{ borderTop: "1px solid #1b2030" }}>
                  <td style={{ ...td, color: r.kind === "aircraft" ? "#facc15" : "#22c55e" }}>{r.kind}</td>
                  <td style={td}>{r.name ?? "—"}</td>
                  <td style={{ ...td, color: "#8b95a7" }}>{r.externalId}</td>
                  <td style={tdNum}>{r.lat.toFixed(2)}</td>
                  <td style={tdNum}>{r.lng.toFixed(2)}</td>
                  <td style={tdNum}>
                    {r.kind === "aircraft"
                      ? r.altM != null
                        ? `${r.altM.toFixed(0)} m`
                        : "—"
                      : r.speed != null
                        ? `${r.speed.toFixed(1)} kn`
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
