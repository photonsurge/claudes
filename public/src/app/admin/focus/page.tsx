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
import { useCallback, useState, Fragment, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { SEGMENT_KINDS, type SegmentKind } from "@photonsurge/shared/director";
import type { FocusBundle, FocusDetail } from "../../../lib/focus/types";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { surface } from "../../../theme/tokens";

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
    <AdminPageShell
      title="Focus bundle debug"
      maxWidth={1180}
      description={
        <>
          One <code>/api/focus</code> request per on-air “thing” — replaces the 30–80 a cut used to fire.
        </>
      }
    >
      {/* presets */}
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mb: 1.75 }}>
        {PRESETS.map((p) => {
          const active = p.kind === kind && p.lng === lng && p.lat === lat;
          return (
            <Chip
              key={p.label}
              label={p.label}
              onClick={() => applyPreset(p)}
              color={active ? "primary" : "default"}
              variant={active ? "filled" : "outlined"}
            />
          );
        })}
      </Stack>

      {/* controls */}
      <Paper sx={{ display: "flex", gap: 1.75, flexWrap: "wrap", alignItems: "flex-end", p: 1.5, mb: 2 }}>
        <TextField select label="Kind" value={kind} onChange={(e) => setKind(e.target.value as SegmentKind)} sx={{ minWidth: 130 }}>
          {SEGMENT_KINDS.map((k) => (
            <MenuItem key={k} value={k}>
              {k}
            </MenuItem>
          ))}
          <MenuItem value="point">point</MenuItem>
        </TextField>
        <TextField select label="Detail" value={detail} onChange={(e) => setDetail(e.target.value as FocusDetail)} sx={{ minWidth: 130 }}>
          {DETAILS.map((d) => (
            <MenuItem key={d} value={d}>
              {d}
            </MenuItem>
          ))}
        </TextField>
        <NumInput label="Lng" value={lng} onChange={setLng} />
        <NumInput label="Lat" value={lat} onChange={setLat} />
        <NumInput label="Zoom" value={zoom} onChange={setZoom} />
        <TextField
          label="Subject (id)"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="us7000abcd / sahel"
          sx={{ width: 190 }}
        />
        {/* The whole page exists to fire this — the one contained button here. */}
        <Button variant="contained" onClick={run} disabled={loading} sx={{ minWidth: 96 }}>
          {loading ? "Fetching…" : "Fetch"}
        </Button>
      </Paper>

      {/* status pills */}
      {meta && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 2 }}>
          <Pill label="cache" value={meta.cache} color={meta.cache === "hit" ? "success.main" : "warning.main"} />
          <Pill label="time" value={`${meta.ms} ms`} />
          <Pill label="size" value={`${(meta.bytes / 1024).toFixed(1)} KB`} />
          {bundle && <Pill label="key" value={bundle.key} />}
        </Stack>
      )}

      {error && (
        <Paper sx={{ p: 1.5, mb: 2 }}>
          <Typography component="pre" variant="caption" color="error.main" sx={{ m: 0, whiteSpace: "pre-wrap" }}>
            {error}
          </Typography>
        </Paper>
      )}

      {bundle && (
        <>
          {/* contract, grouped */}
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 1.5, mb: 2 }}>
            {GROUPS.map((g) => (
              <Paper key={g.title} sx={{ p: 1.5 }}>
                <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                  {g.title}
                </Typography>
                {(g.arrays ?? []).map((f) => {
                  const v = bundle[f];
                  const ok = Array.isArray(v);
                  const n = ok ? (v as unknown[]).length : 0;
                  return (
                    <Row key={f as string} name={f as string} tone={!ok ? "error.main" : n ? "text.primary" : "text.secondary"}>
                      {ok ? String(n) : "NOT ARRAY"}
                    </Row>
                  );
                })}
                {(g.objects ?? []).map((f) => {
                  const present = bundle[f] != null;
                  return (
                    <Row
                      key={f as string}
                      name={f as string}
                      tone={present ? "success.main" : "text.secondary"}
                      dot={present ? "●" : "○"}
                    >
                      {present ? "resolved" : "null"}
                    </Row>
                  );
                })}
              </Paper>
            ))}
          </Box>

          {/* highlights — eyeball correctness without reading JSON */}
          <Paper sx={{ p: 1.5, mb: 2 }}>
            <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Highlights
            </Typography>
            <Highlights bundle={bundle} />
          </Paper>

          {/* raw json (collapsible) */}
          <Button variant="outlined" onClick={() => setShowRaw((s) => !s)} sx={{ mb: 1 }}>
            {showRaw ? "▾ Hide raw bundle" : "▸ Show raw bundle"}
          </Button>
          {showRaw && (
            <Paper sx={{ p: 1.5, bgcolor: surface.sunken }}>
              <Typography
                component="pre"
                sx={{ m: 0, fontSize: 11, lineHeight: 1.5, maxHeight: 560, overflow: "auto", whiteSpace: "pre-wrap" }}
              >
                {JSON.stringify(bundle, null, 2)}
              </Typography>
            </Paper>
          )}
        </>
      )}
    </AdminPageShell>
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
    <Box sx={{ display: "grid", gridTemplateColumns: "110px 1fr", rowGap: 0.75, columnGap: 1.5, fontSize: 13 }}>
      {items.map((it) => (
        <Fragment key={it.k}>
          <Box sx={{ color: "text.secondary" }}>{it.k}</Box>
          <Box>{it.v}</Box>
        </Fragment>
      ))}
    </Box>
  );
}

function Row({ name, children, tone, dot }: { name: string; children: ReactNode; tone: string; dot?: string }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12.5, py: 0.25 }}>
      <Box component="span" sx={{ color: "text.secondary" }}>
        {dot ? (
          <Box component="span" sx={{ color: tone, mr: 0.5 }}>
            {dot}
          </Box>
        ) : null}
        {name}
      </Box>
      {/* A field's count/state is the reading you scan the column for. */}
      <Box component="code" sx={{ color: tone, fontWeight: 700 }}>
        {children}
      </Box>
    </Box>
  );
}

function Pill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Paper sx={{ px: 1.25, py: 0.625, display: "inline-flex", gap: 0.75, alignItems: "center", maxWidth: "100%" }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box
        component="code"
        sx={{ fontSize: 12, fontWeight: 700, color: color ?? "text.primary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {value}
      </Box>
    </Paper>
  );
}

function NumInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <TextField
      label={label}
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      slotProps={{ htmlInput: { step: 0.1 } }}
      sx={{ width: 100 }}
    />
  );
}
