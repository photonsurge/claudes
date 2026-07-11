"use client";

/**
 * /admin/focus — the FocusBundle debug harness.
 *
 * The problem it solves: you can normally only see a quake/volcano/country/region
 * deck when the director happens to cut to one. This page fetches /api/focus for
 * ANY kind + point + detail on demand, so every bundle path is reachable for QA.
 * Shows the raw bundle, a per-field contract check (arrays present, roundups /
 * target resolved), and the cache marker + timing + byte size — so you can watch
 * the 80→1 collapse and confirm Redis hits. (The "render the real slide deck"
 * view lands with FocusProvider in Phase 1; Phase 0 verifies the payload.)
 */
import { useCallback, useState } from "react";
import { SEGMENT_KINDS, type SegmentKind } from "@photonsurge/shared/director";
import type { FocusBundle, FocusDetail } from "../../../lib/focus/types";

const DETAILS: FocusDetail[] = ["broadcast", "admin", "full"];

interface Preset {
  label: string;
  kind: SegmentKind;
  lng: number;
  lat: number;
  zoom: number;
  subject?: string;
}
// Curated starting points per kind so QA is repeatable. Subjects are illustrative
// — use the free field with a live id from the feeds to resolve a real target.
const PRESETS: Preset[] = [
  { label: "Country · UK", kind: "country", lng: -2.0, lat: 54.0, zoom: 4.6 },
  { label: "Country · Japan", kind: "country", lng: 138.0, lat: 37.0, zoom: 4.4 },
  { label: "Region · Sahel", kind: "region", lng: 5.0, lat: 15.0, zoom: 3.2, subject: "sahel" },
  { label: "Quake · point", kind: "quake", lng: 143.0, lat: 38.3, zoom: 5.0 },
  { label: "Storm · coastal", kind: "storm", lng: -80.2, lat: 25.8, zoom: 5.2 },
  { label: "Volcano · point", kind: "volcano", lng: 14.99, lat: 37.75, zoom: 6.0 },
  { label: "Ocean · wide", kind: "ocean", lng: -140.0, lat: 0.0, zoom: 2.4 },
  { label: "Global · spin", kind: "global", lng: 0.0, lat: 20.0, zoom: 1.8 },
];

const ARRAY_FIELDS: (keyof FocusBundle)[] = [
  "pointHistory", "areaHistory", "pointForecast", "areaForecast", "climate",
  "topCities", "nearbyCities", "cityConditions", "areaAlerts", "areaQuakes",
  "areaVolcanoes", "seismoStations", "tideStations", "nearbyCams",
];
const OBJECT_FIELDS: (keyof FocusBundle)[] = [
  "target", "country", "countryRoundup", "region", "regionRoundup", "areaWeather", "depthProfile",
];

const box: React.CSSProperties = { background: "#0d1420", border: "1px solid #22304a", borderRadius: 6, padding: 8 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.6, color: "#9fb3cc" };

export default function FocusDebugPage() {
  const [kind, setKind] = useState<SegmentKind>("country");
  const [detail, setDetail] = useState<FocusDetail>("broadcast");
  const [lng, setLng] = useState(-2.0);
  const [lat, setLat] = useState(54.0);
  const [zoom, setZoom] = useState(4.6);
  const [subject, setSubject] = useState("");
  const [bundle, setBundle] = useState<FocusBundle | null>(null);
  const [meta, setMeta] = useState<{ cache: string; ms: number; bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const applyPreset = (p: Preset) => {
    setKind(p.kind);
    setLng(p.lng);
    setLat(p.lat);
    setZoom(p.zoom);
    setSubject(p.subject ?? "");
  };

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      kind, lng: String(lng), lat: String(lat), zoom: String(zoom), detail,
    });
    if (subject.trim()) qs.set("subject", subject.trim());
    const t0 = performance.now();
    try {
      const res = await fetch(`/api/focus?${qs.toString()}`, { cache: "no-store" });
      const text = await res.text();
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) {
        setError(`${res.status}: ${text}`);
        setBundle(null);
        setMeta({ cache: res.headers.get("X-Focus-Cache") ?? "-", ms, bytes: text.length });
        return;
      }
      setBundle(JSON.parse(text) as FocusBundle);
      setMeta({ cache: res.headers.get("X-Focus-Cache") ?? "-", ms, bytes: text.length });
    } catch (e) {
      setError(String(e));
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }, [kind, detail, lng, lat, zoom, subject]);

  return (
    <main style={{ padding: 16, color: "#e6edf6", maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>Focus bundle debug</h1>
      <p style={{ color: "#9fb3cc", fontSize: 13 }}>
        Fetch <code>/api/focus</code> for any kind/point/detail. One request replaces the 30–80 a cut used to fire.
      </p>

      {/* presets */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => applyPreset(p)} style={{ ...box, cursor: "pointer", fontSize: 12 }}>
            {p.label}
          </button>
        ))}
      </div>

      {/* controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
        <div>
          <div style={label}>KIND</div>
          <select value={kind} onChange={(e) => setKind(e.target.value as SegmentKind)}>
            {SEGMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            <option value="point">point</option>
          </select>
        </div>
        <div>
          <div style={label}>DETAIL</div>
          <select value={detail} onChange={(e) => setDetail(e.target.value as FocusDetail)}>
            {DETAILS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <Num name="LNG" value={lng} onChange={setLng} />
        <Num name="LAT" value={lat} onChange={setLat} />
        <Num name="ZOOM" value={zoom} onChange={setZoom} />
        <div>
          <div style={label}>SUBJECT (id)</div>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. us7000abcd / sahel" style={{ width: 200 }} />
        </div>
        <button onClick={run} disabled={loading} style={{ ...box, cursor: "pointer", fontWeight: 800 }}>
          {loading ? "…" : "Fetch"}
        </button>
      </div>

      {meta && (
        <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 13 }}>
          <span>cache: <b style={{ color: meta.cache === "hit" ? "#4ade80" : "#fbbf24" }}>{meta.cache}</b></span>
          <span>time: <b>{meta.ms} ms</b></span>
          <span>size: <b>{(meta.bytes / 1024).toFixed(1)} KB</b></span>
        </div>
      )}

      {error && <pre style={{ ...box, color: "#f87171", whiteSpace: "pre-wrap" }}>{error}</pre>}

      {bundle && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* contract check */}
          <div>
            <div style={label}>CONTRACT</div>
            <div style={{ ...box, fontSize: 12, lineHeight: 1.9 }}>
              {ARRAY_FIELDS.map((f) => {
                const v = bundle[f];
                const ok = Array.isArray(v);
                return (
                  <div key={f as string}>
                    <span style={{ color: ok ? "#4ade80" : "#f87171" }}>{ok ? "✓" : "✗"}</span>{" "}
                    {f as string}: <b>{ok ? (v as unknown[]).length : "NOT AN ARRAY"}</b>
                  </div>
                );
              })}
              {OBJECT_FIELDS.map((f) => {
                const v = bundle[f];
                const present = v != null;
                return (
                  <div key={f as string}>
                    <span style={{ color: "#9fb3cc" }}>{present ? "●" : "○"}</span>{" "}
                    {f as string}: <b>{present ? "resolved" : "null"}</b>
                  </div>
                );
              })}
            </div>
          </div>
          {/* raw json */}
          <div>
            <div style={label}>RAW BUNDLE</div>
            <pre style={{ ...box, fontSize: 11, maxHeight: 600, overflow: "auto", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(bundle, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </main>
  );
}

function Num({ name, value, onChange }: { name: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <div style={label}>{name}</div>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: 90 }}
      />
    </div>
  );
}
