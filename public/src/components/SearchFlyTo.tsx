"use client";

/**
 * Geocode search box + region preset buttons. On a hit it fitBounds to the
 * bbox; region presets fitBounds to their preset bbox.
 */
import { useState } from "react";
import { REGION_PRESETS } from "@photonsurge/shared/regions";
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
    onFitBounds(hit.bbox);
    onFlyTo?.(hit.center);
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
        {REGION_PRESETS.map((r) => (
          <button key={r.id} type="button" onClick={() => onFitBounds(r.bbox)} style={chip}>
            {r.label}
          </button>
        ))}
      </div>
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
const chip: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 11,
  borderRadius: 5,
  border: "1px solid #333",
  background: "#1a1f2b",
  color: "#fff",
  cursor: "pointer",
};
