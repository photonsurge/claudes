"use client";

/**
 * /admin/weather — diagnostic view of the baked weather runs per model. Shows
 * which variables actually baked, how many forecast hours, and WHEN (so a
 * starved/partial ingest — e.g. only temp/humidity present, or a run "baked 2d
 * ago" — is obvious). The newest run per model shows raw-data texture
 * thumbnails; older runs collapse to a one-line summary.
 */
import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { font, surface } from "../../../theme/tokens";

interface VarInfo {
  id: string;
  encoding: string;
  units: string;
  fhrCount: number;
  firstFhr: number | null;
  lastFhr: number | null;
  thumbTexId: string | null;
}
interface RunInfo {
  id: string;
  model: string;
  run: string;
  generatedAt: string | null;
  ageMs: number | null;
  status: string;
  published: boolean;
  grid: { width: number; height: number; res: number } | null;
  variableCount: number;
  textureCount: number;
  variables: VarInfo[];
}

const POLL_MS = 20_000;
const texUrl = (id: string) => `/api/weather/tex/${id}.png`;

/** DESIGN_BIBLE §3: run stamps, ages, grid sizes and fhr counts are readings. */
const reading = { fontFamily: font.mono, fontVariantNumeric: "tabular-nums" } as const;

const fmtTime = (iso?: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};
const fmtAge = (ms: number | null): string => {
  if (ms == null) return "never";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export default function WeatherRunsPage() {
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/weather", { cache: "no-store" });
      const body = await res.json();
      setRuns(Array.isArray(body?.runs) ? body.runs : []);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  const byModel = new Map<string, RunInfo[]>();
  for (const r of runs) {
    const a = byModel.get(r.model) ?? [];
    a.push(r);
    byModel.set(r.model, a);
  }
  // gfs first (it's the base + the one that's been troublesome), then alpha.
  const models = [...byModel.keys()].sort((a, b) =>
    a === "gfs" ? -1 : b === "gfs" ? 1 : a.localeCompare(b),
  );

  return (
    <AdminPageShell
      title="Weather runs"
      description="Every baked weather run per model — which variables actually baked, how many forecast hours, and when. The newest run per model shows raw-data texture thumbnails (not palette-coloured — just to confirm a field baked)."
      actions={
        <Button variant="outlined" onClick={reload}>
          Refresh
        </Button>
      }
      maxWidth={1280}
    >
      {err && (
        <Typography variant="body2" color="error.main" sx={{ mb: 1.5 }}>
          Failed to load: {err}
        </Typography>
      )}
      {runs.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {loading ? "Loading…" : "No weather runs in the database yet."}
        </Typography>
      )}

      {models.map((model) => {
        const list = byModel.get(model)!;
        return (
          <Box component="section" key={model} sx={{ mb: 3.5 }}>
            <Typography variant="h2" component="h2" sx={{ mb: 1.25 }}>
              {model}{" "}
              <Box component="span" sx={{ color: "text.disabled", fontWeight: 400 }}>
                · {list.length} run(s)
              </Box>
            </Typography>

            {list.map((r, i) => (
              <Paper key={r.id} sx={{ px: 1.75, py: 1.5, mb: 1.25 }}>
                <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "baseline" }}>
                  <Typography variant="body2" sx={{ ...reading, fontWeight: 700 }}>
                    {fmtTime(r.run)}
                  </Typography>
                  <StatusBadge status={r.status} published={r.published} />
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                    baked <Box component="span" sx={reading}>{fmtAge(r.ageMs)}</Box>
                  </Typography>
                  {r.generatedAt && (
                    <Typography variant="caption" color="text.secondary" sx={{ ...reading, whiteSpace: "nowrap" }}>
                      ({fmtTime(r.generatedAt)})
                    </Typography>
                  )}
                  {r.grid && (
                    <Typography variant="caption" color="text.secondary" sx={{ ...reading, whiteSpace: "nowrap" }}>
                      {r.grid.width}×{r.grid.height}
                    </Typography>
                  )}
                  {/* A run with zero variables baked nothing — that's a failure
                      to spot at a glance, not a neutral count. */}
                  <Typography
                    variant="caption"
                    sx={{ ...reading, whiteSpace: "nowrap", color: r.variableCount ? "text.secondary" : "error.main" }}
                  >
                    {r.variableCount} vars · {r.textureCount} textures
                  </Typography>
                </Stack>

                {/* Only the newest run per model renders thumbnails (keeps it fast). */}
                {i === 0 ? (
                  <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", mt: 1.5 }}>
                    {r.variables.map((v) => (
                      <Box key={v.id} sx={{ width: 122 }}>
                        {v.thumbTexId ? (
                          <Box
                            component="img"
                            src={texUrl(v.thumbTexId)}
                            alt={`${r.model} ${v.id}`}
                            width={122}
                            height={61}
                            loading="lazy"
                            sx={thumbSx}
                          />
                        ) : (
                          <Box sx={{ ...thumbSx, display: "flex", alignItems: "center", justifyContent: "center", color: "text.disabled", fontSize: 10 }}>
                            no texture
                          </Box>
                        )}
                        <Typography variant="caption" component="div" sx={{ fontWeight: 600, mt: 0.5 }}>
                          {v.id}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ ...reading, fontSize: 11 }}>
                          {v.encoding} · {v.fhrCount} fhr
                          {v.firstFhr != null && v.lastFhr != null ? ` (f${v.firstFhr}–f${v.lastFhr})` : ""}
                        </Typography>
                      </Box>
                    ))}
                    {r.variables.length === 0 && (
                      <Typography variant="body2" color="error.main">
                        no variables baked in this run
                      </Typography>
                    )}
                  </Stack>
                ) : (
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }}>
                    {r.variables.map((v) => v.id).join(", ") || "—"}
                  </Typography>
                )}
              </Paper>
            ))}
          </Box>
        );
      })}
    </AdminPageShell>
  );
}

function StatusBadge({ status, published }: { status: string; published: boolean }) {
  // A "pending" run that is already published is BAKING LIVE — its maps are going
  // on air field-by-field (progressive publish) while the rest still bake.
  const color =
    status === "complete"
      ? published
        ? "success"
        : "warning"
      : status === "failed"
        ? "error"
        : published
          ? "primary"
          : "default";
  const label =
    status === "complete"
      ? published
        ? "published"
        : "complete · unpublished"
      : status === "pending"
        ? published
          ? "baking · live"
          : "baking…"
        : status;
  return <Chip label={label} color={color} />;
}

const thumbSx = {
  width: 122,
  height: 61,
  objectFit: "cover",
  borderRadius: 1,
  border: 1,
  borderColor: "divider",
  bgcolor: surface.sunken,
  display: "block",
} as const;
