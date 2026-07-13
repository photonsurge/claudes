"use client";

/**
 * /admin/focus — the FocusBundle debug harness.
 *
 * The problem it solves: you can normally only see a quake/volcano/country/region
 * deck when the director happens to cut to one. This page fetches /api/focus for
 * ANY kind + point + detail on demand, so every bundle path is reachable for QA.
 * Shows a grouped per-field contract check, a human-readable highlights panel
 * (resolved target / roundup / top city), and the cache marker + timing + byte
 * size — so you can watch the 80→1 collapse and confirm Redis hits. (The "render
 * the real slide deck" view lands with FocusProvider in Phase 1.)
 */
import { useCallback, useState, Fragment, type CSSProperties, type ReactNode } from "react";
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
const PRESETS: Preset[] = [
  { label: "Country · UK", kind: "country", lng: -2.0, lat: 54.0, zoom: 4.6 },
  { label: "Country · Japan", kind: "country", lng: 138.0, lat: 37.0, zoom: 4.4 },
  { label: "Region · Mediterranean", kind: "region", lng: 15.0, lat: 38.5, zoom: 3.6, subject: "mediterranean" },
  { label: "Region · East Asia", kind: "region", lng: 123.0, lat: 33.0, zoom: 3.4, subject: "east_asia" },
  { label: "Quake · point", kind: "quake", lng: 143.0, lat: 38.3, zoom: 5.0 },
  { label: "Storm · coastal", kind: "storm", lng: -80.2, lat: 25.8, zoom: 5.2 },
  { label: "Volcano · point", kind: "volcano", lng: 14.99, lat: 37.75, zoom: 6.0 },
  { label: "Ocean · wide", kind: "ocean", lng: -140.0, lat: 0.0, zoom: 2.4 },
  { label: "Global · spin", kind: "global", lng: 0.0, lat: 20.0, zoom: 1.8 },
];

// Contract fields grouped by concern, so the panel reads like the deck it feeds.
const GROUPS: { title: string; arrays?: (keyof FocusBundle)[]; objects?: (keyof FocusBundle)[] }[] = [
  { title: "Weather", arrays: ["pointHistory", "areaHistory", "pointForecast", "areaForecast", "climate"] },
  { title: "Cities", arrays: ["topCities", "nearbyCities", "cityConditions"] },
  { title: "Event + area", objects: ["target"], arrays: ["areaAlerts", "areaQuakes", "areaVolcanoes"] },
  { title: "Place + roundup", objects: ["country", "countryRoundup", "region", "regionRoundup", "areaWeather"] },
  { title: "Geophysics + media", arrays: ["seismoStations", "tideStations", "nearbyCams", "volcanoMedia"], objects: ["depthProfile"] },
];

// ── styles ────────────────────────────────────────────────────────────────
const C = {
  bg: "#0a0f18",
  card: "#0f1826",
  border: "#1e2b42",
  ink: "#e6edf6",
  muted: "#8ba0bd",
  accent: "#5b9dff",
  ok: "#4ade80",
  warn: "#fbbf24",
  bad: "#f87171",
};
const card: CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 };
const legend: CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: 1, color: C.muted, textTransform: "uppercase" };
const ctrl: CSSProperties = { background: "#0b1220", color: C.ink, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 13 };

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
  const [showRaw, setShowRaw] = useState(false);

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
    const qs = new URLSearchParams({ kind, lng: String(lng), lat: String(lat), zoom: String(zoom), detail });
    if (subject.trim()) qs.set("subject", subject.trim());
    const t0 = performance.now();
    try {
      const res = await fetch(`/api/focus?${qs.toString()}`, { cache: "no-store" });
      const text = await res.text();
      const ms = Math.round(performance.now() - t0);
      const cache = res.headers.get("X-Focus-Cache") ?? "-";
      setMeta({ cache, ms, bytes: text.length });
      if (!res.ok) {
        setError(`${res.status}: ${text}`);
        setBundle(null);
        return;
      }
      setBundle(JSON.parse(text) as FocusBundle);
    } catch (e) {
      setError(String(e));
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }, [kind, detail, lng, lat, zoom, subject]);

  return (
    <main style={{ position: "relative", minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "system-ui, sans-serif", colorScheme: "dark" }}>
      {/* full-viewport dark backdrop so the white body never bleeds around/below the content */}
      <div aria-hidden style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 0 }} />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1180, margin: "0 auto", padding: "20px 20px 60px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Focus bundle debug</h1>
        <p style={{ color: C.muted, fontSize: 13, margin: "4px 0 16px" }}>
          One <code style={{ color: C.accent }}>/api/focus</code> request per on-air “thing” — replaces the 30–80 a cut used to fire.
        </p>

        {/* presets */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {PRESETS.map((p) => {
            const active = p.kind === kind && p.lng === lng && p.lat === lat;
            return (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                style={{
                  ...ctrl,
                  cursor: "pointer",
                  fontSize: 12,
                  borderColor: active ? C.accent : C.border,
                  color: active ? C.accent : C.ink,
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* controls */}
        <div style={{ ...card, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
          <Field name="Kind">
            <select value={kind} onChange={(e) => setKind(e.target.value as SegmentKind)} style={ctrl}>
              {SEGMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              <option value="point">point</option>
            </select>
          </Field>
          <Field name="Detail">
            <select value={detail} onChange={(e) => setDetail(e.target.value as FocusDetail)} style={ctrl}>
              {DETAILS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field name="Lng"><NumInput value={lng} onChange={setLng} /></Field>
          <Field name="Lat"><NumInput value={lat} onChange={setLat} /></Field>
          <Field name="Zoom"><NumInput value={zoom} onChange={setZoom} /></Field>
          <Field name="Subject (id)">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="us7000abcd / sahel" style={{ ...ctrl, width: 190 }} />
          </Field>
          <button onClick={run} disabled={loading} style={{ ...ctrl, cursor: "pointer", fontWeight: 800, background: C.accent, color: "#04101f", borderColor: C.accent, minWidth: 96 }}>
            {loading ? "Fetching…" : "Fetch"}
          </button>
        </div>

        {/* status pills */}
        {meta && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <Pill label="cache" value={meta.cache} color={meta.cache === "hit" ? C.ok : C.warn} />
            <Pill label="time" value={`${meta.ms} ms`} />
            <Pill label="size" value={`${(meta.bytes / 1024).toFixed(1)} KB`} />
            {bundle && <Pill label="key" value={bundle.key} mono />}
          </div>
        )}

        {error && (
          <pre style={{ ...card, color: C.bad, whiteSpace: "pre-wrap", fontSize: 12, marginBottom: 16 }}>{error}</pre>
        )}

        {bundle && (
          <>
            {/* contract, grouped */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginBottom: 16 }}>
              {GROUPS.map((g) => (
                <div key={g.title} style={card}>
                  <div style={{ ...legend, marginBottom: 8 }}>{g.title}</div>
                  {(g.arrays ?? []).map((f) => {
                    const v = bundle[f];
                    const ok = Array.isArray(v);
                    const n = ok ? (v as unknown[]).length : 0;
                    return (
                      <Row key={f as string} name={f as string} tone={!ok ? C.bad : n ? C.ink : C.muted}>
                        {ok ? String(n) : "NOT ARRAY"}
                      </Row>
                    );
                  })}
                  {(g.objects ?? []).map((f) => {
                    const present = bundle[f] != null;
                    return (
                      <Row key={f as string} name={f as string} tone={present ? C.ok : C.muted} dot={present ? "●" : "○"}>
                        {present ? "resolved" : "null"}
                      </Row>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* highlights — eyeball correctness without reading JSON */}
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ ...legend, marginBottom: 8 }}>Highlights</div>
              <Highlights bundle={bundle} />
            </div>

            {/* raw json (collapsible) */}
            <button onClick={() => setShowRaw((s) => !s)} style={{ ...ctrl, cursor: "pointer", fontSize: 12, marginBottom: 8 }}>
              {showRaw ? "▾ Hide raw bundle" : "▸ Show raw bundle"}
            </button>
            {showRaw && (
              <pre style={{ ...card, fontSize: 11, lineHeight: 1.5, maxHeight: 560, overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "ui-monospace, monospace" }}>
                {JSON.stringify(bundle, null, 2)}
              </pre>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Highlights({ bundle }: { bundle: FocusBundle }) {
  const items: { k: string; v: string }[] = [];
  const t = bundle.target;
  if (t?.kind === "quake") items.push({ k: "target", v: `Quake M${t.quake.mag} · ${t.quake.depthKm}km · ${t.quake.place ?? "—"}` });
  else if (t?.kind === "volcano") items.push({ k: "target", v: `Volcano ${t.volcano.name} (${t.volcano.status})` });
  else if (t?.kind === "storm") items.push({ k: "target", v: `Alert ${t.alert.properties.event} (${t.alert.properties.severityRank})` });
  else items.push({ k: "target", v: "—" });

  if (bundle.country) items.push({ k: "country", v: `${bundle.country.name} (${bundle.country.iso2 ?? "?"})` });
  if (bundle.region) items.push({ k: "region", v: bundle.region.name });
  const roundup = bundle.countryRoundup ?? bundle.regionRoundup;
  const narrative = roundup?.narrative ?? roundup?.summary;
  if (narrative) items.push({ k: "roundup", v: narrative.slice(0, 220) + (narrative.length > 220 ? "…" : "") });
  const top = bundle.topCities[0]?.city;
  if (top) items.push({ k: "top city", v: `${top.name}${top.population ? ` · ${top.population.toLocaleString()}` : ""}` });
  items.push({ k: "history vars", v: bundle.pointHistory.map((s) => s.variable).join(", ") || "—" });
  items.push({ k: "forecast days", v: String(bundle.pointForecast.length || bundle.areaForecast.length) });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", rowGap: 6, columnGap: 12, fontSize: 13 }}>
      {items.map((it) => (
        <Fragment key={it.k}>
          <div style={{ color: C.muted }}>{it.k}</div>
          <div>{it.v}</div>
        </Fragment>
      ))}
    </div>
  );
}

function Row({ name, children, tone, dot }: { name: string; children: ReactNode; tone: string; dot?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12.5, padding: "2px 0" }}>
      <span style={{ color: C.muted }}>
        {dot ? <span style={{ color: tone, marginRight: 4 }}>{dot}</span> : null}
        {name}
      </span>
      <b style={{ color: tone, fontVariantNumeric: "tabular-nums" }}>{children}</b>
    </div>
  );
}

function Pill({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <span style={{ ...card, padding: "5px 10px", fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center", maxWidth: "100%" }}>
      <span style={{ color: C.muted }}>{label}</span>
      <b style={{ color: color ?? C.ink, fontFamily: mono ? "ui-monospace, monospace" : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</b>
    </span>
  );
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={legend}>{name}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return <input type="number" step="0.1" value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ...ctrl, width: 90 }} />;
}
