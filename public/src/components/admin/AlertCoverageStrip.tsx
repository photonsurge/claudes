"use client";

/**
 * AlertCoverageStrip — a one-row summary of how many active alerts can actually
 * DRAW on the globe, for the top of /admin/alerts. "How many are failing" at a
 * glance: total, fully drawable, no-shape (the failures), partial, and the % of
 * areas resolved. Self-polls /api/admin/alerts/coverage (a light Mongo read).
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { font } from "../../theme/tokens";

interface Coverage {
  alerts: number;
  alertsNoShape: number;
  alertsPartial: number;
  areas: number;
  areasNoGeom: number;
  drawableAlerts: number;
  areasDrawn: number;
  areasDrawnPct: number;
  alertsDrawnPct: number;
}

function Cell({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "good" | "warn" | "bad";
  title?: string;
}) {
  const color = tone === "bad" ? "error.main" : tone === "warn" ? "warning.main" : tone === "good" ? "success.main" : "text.primary";
  return (
    <Box title={title} sx={{ minWidth: 78 }}>
      <Typography sx={{ fontFamily: font.mono, fontWeight: 700, fontSize: 20, lineHeight: 1.15, color, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.disabled" sx={{ display: "block", lineHeight: 1.2 }}>
        {label}
        {sub ? ` · ${sub}` : ""}
      </Typography>
    </Box>
  );
}

export default function AlertCoverageStrip({ pollMs = 30000 }: { pollMs?: number }) {
  const [cov, setCov] = useState<Coverage | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/admin/alerts/coverage", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((c: Coverage) => alive && (setCov(c), setErr(false)))
        .catch(() => alive && setErr(true));
    load();
    const iv = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [pollMs]);

  if (err && !cov) return null; // don't clutter the page if the read fails
  if (!cov) {
    return (
      <Paper sx={{ mt: 2, p: 2 }}>
        <Typography variant="caption" color="text.disabled">
          Loading drawable coverage…
        </Typography>
      </Paper>
    );
  }

  const failing = cov.alertsNoShape;
  return (
    <Paper sx={{ mt: 2, p: 2 }}>
      <Stack direction="row" spacing={{ xs: 2.5, sm: 4 }} useFlexGap sx={{ flexWrap: "wrap", alignItems: "flex-start" }}>
        <Cell label="alerts w/ areas" value={cov.alerts} title="Active alerts that carry at least one area (a feed with no areas isn't a geometry gap)" />
        <Cell
          label="drawable"
          value={cov.drawableAlerts}
          sub={`${cov.alertsDrawnPct}%`}
          tone="good"
          title="Alerts with at least one area that has a polygon"
        />
        <Cell
          label="NO shape"
          value={failing}
          tone={failing > 0 ? "bad" : "good"}
          title="Alerts where NOT ONE area resolved to a polygon — these can't draw at all"
        />
        <Cell
          label="partial"
          value={cov.alertsPartial}
          tone={cov.alertsPartial > 0 ? "warn" : undefined}
          title="Alerts where some areas draw and some don't"
        />
        <Box sx={{ flex: 1, minWidth: 190 }}>
          <Stack direction="row" sx={{ alignItems: "baseline", mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              areas drawn
            </Typography>
            <Typography sx={{ ml: "auto", fontFamily: font.mono, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {cov.areasDrawn}
              <Box component="span" sx={{ color: "text.disabled", fontWeight: 400 }}>
                {" "}
                / {cov.areas} · {cov.areasDrawnPct}%
              </Box>
            </Typography>
          </Stack>
          <Box sx={{ height: 8, borderRadius: 1, bgcolor: "action.hover", overflow: "hidden" }}>
            <Box
              sx={{
                width: `${cov.areasDrawnPct}%`,
                height: "100%",
                borderRadius: 1,
                bgcolor: cov.areasDrawnPct >= 85 ? "success.main" : cov.areasDrawnPct >= 60 ? "warning.main" : "error.main",
                transition: "width 400ms ease",
              }}
            />
          </Box>
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.5 }}>
            {cov.areasNoGeom} area{cov.areasNoGeom === 1 ? "" : "s"} still shapeless
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}
