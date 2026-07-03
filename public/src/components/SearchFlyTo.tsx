"use client";

/**
 * Geocode search box + grouped region picker. On a hit it fitBounds to the
 * bbox; the picker fitBounds to a preset/country bbox.
 */
import { useState } from "react";
import RegionPicker from "./RegionPicker";
import { geocode } from "../lib/geocode";

export interface SearchFlyToProps {
  onFitBounds: (bbox: [number, number, number, number]) => void;
  onFlyTo?: (center: [number, number], zoom?: number) => void;
}

export default function SearchFlyTo({ onFitBounds, onFlyTo }: SearchFlyToProps) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    const hit = await geocode(q);
    setBusy(false);
    if (!hit) {
      setError("No result");
      return;
    }
    // A real bbox frames the place; fall back to a point flyTo only if the
    // geocoder gave us a degenerate (zero-area) box. Never fire both — two
    // competing transitions cancel each other out.
    const [w, s, e, n] = hit.bbox;
    if (onFlyTo && (e - w < 1e-6 || n - s < 1e-6)) onFlyTo(hit.center);
    else onFitBounds(hit.bbox);
  };

  return (
    <div style={{ color: "#fff" }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        style={{ display: "flex", gap: 6 }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search place…"
          aria-label="search place"
          style={{
            flex: 1,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #333",
            background: "#0f131c",
            color: "#fff",
          }}
        />
        <button type="submit" disabled={busy} style={btn}>
          {busy ? "…" : "Go"}
        </button>
      </form>
      {error && <div style={{ color: "#f87171", fontSize: 11, marginTop: 4 }}>{error}</div>}
      <RegionPicker onFitBounds={onFitBounds} />
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
