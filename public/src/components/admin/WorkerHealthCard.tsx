"use client";

/**
 * WorkerHealthCard — a compact, self-contained worker-health panel for a sidebar
 * rail (the /admin/jobs right column). The "key shit" at a glance: rss + JS-heap
 * against the OOM ceiling, the three queue lanes with their concurrency caps, and
 * the bake-thread pool. Self-polls /api/admin/worker-stats (the proxy to the
 * worker's internal /status), like QueueSummary/LogTail do — drop it in, no props.
 *
 * The full picture (per-event memory ledger, stalled-job detection) lives on
 * /admin/queue; this is the "is the worker healthy right now" glance.
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MemoryGauge from "./MemoryGauge";
import LanePill from "./LanePill";
import BakePoolStrip from "./BakePoolStrip";
import { pendingOf, type WorkerStats } from "../../lib/worker-stats";
import { font } from "../../theme/tokens";

function fmtUptime(sec?: number): string {
  if (!sec) return "—";
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.round((sec % 86400) / 3600)}h`;
}

export default function WorkerHealthCard({ pollMs = 5000 }: { pollMs?: number }) {
  const [stats, setStats] = useState<WorkerStats | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/admin/worker-stats", { cache: "no-store" })
        .then((r) => r.json())
        .then((s: WorkerStats) => alive && setStats(s))
        .catch(() => {});
    load();
    const iv = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [pollMs]);

  const ok = stats?.status === "ok";

  return (
    <Paper sx={{ p: 1.75 }}>
      <Stack direction="row" sx={{ alignItems: "baseline", mb: 1.25 }}>
        <Typography variant="overline" color="text.secondary">
          Worker health
        </Typography>
        {ok && stats?.uptimeSec != null && (
          <Typography variant="caption" color="text.disabled" sx={{ ml: "auto", fontFamily: font.mono }}>
            up {fmtUptime(stats.uptimeSec)}
          </Typography>
        )}
      </Stack>

      {!stats ? (
        <Typography variant="caption" color="text.disabled">
          loading…
        </Typography>
      ) : !ok ? (
        <Typography variant="caption" color="warning.main">
          worker unavailable — {stats.error || "no /status"}. Restart the worker to populate.
        </Typography>
      ) : (
        <>
          {/* Memory — stacked (the rail is narrow). rss over its peak-scaled bar,
              heap over the V8 ceiling. */}
          <Stack spacing={1.75}>
            <MemoryGauge
              label="RSS"
              value={stats.rssMB ?? 0}
              max={Math.max((stats.rssPeakMB ?? 0) * 1.15, (stats.rssMB ?? 0) * 1.15, 512)}
              peak={stats.rssPeakMB}
              hint="OS footprint"
            />
            <MemoryGauge
              label="JS heap"
              value={stats.heapUsedMB ?? 0}
              max={stats.heapLimitMB || 1}
              hint={stats.heapLimitMB ? `ceiling ${(stats.heapLimitMB / 1024).toFixed(1)}GB` : undefined}
            />
          </Stack>

          {/* Lanes — active/cap +pending per tier. */}
          {stats.byTier?.length ? (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mt: 2 }}>
              {stats.byTier.map((t) => (
                <LanePill
                  key={t.tier}
                  tier={t.tier}
                  name={t.name}
                  active={t.counts.active ?? 0}
                  pending={pendingOf(t.counts)}
                  cap={t.concurrency}
                />
              ))}
            </Stack>
          ) : null}

          {/* Bake-thread pool — why rss runs above heap. */}
          <BakePoolStrip pool={stats.bakePool} />
        </>
      )}
    </Paper>
  );
}
