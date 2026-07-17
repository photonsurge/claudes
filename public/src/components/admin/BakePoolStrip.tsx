"use client";

/**
 * BakePoolStrip — one compact row of bake-thread pool counters, shown inside the
 * /admin/queue "Worker memory" card. The pool is the main reason worker RSS runs
 * far above JS heap (each bake thread is its own V8 isolate), so its lifecycle
 * belongs next to the gauges: `live` is the isolates holding memory right now,
 * `recycled` is memory that has been handed back to the OS, and `crashed` (red)
 * or inline-only serving (amber) is the pool degrading toward main-loop bakes.
 */
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { WorkerBakePoolStats } from "../../lib/worker-stats";
import { font } from "../../theme/tokens";

function Stat({ label, value, tone, title }: { label: string; value: number | string; tone?: "warn" | "error" | "good"; title: string }) {
  const color =
    tone === "error" ? "error.main" : tone === "warn" ? "warning.main" : tone === "good" ? "success.main" : "text.primary";
  return (
    <Stack component="span" direction="row" spacing={0.75} sx={{ alignItems: "baseline" }} title={title}>
      <Box component="span" sx={{ fontSize: 12.5, color: "text.disabled" }}>
        {label}
      </Box>
      <Box component="span" sx={{ fontSize: 13, fontFamily: font.mono, fontWeight: 600, color, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Box>
    </Stack>
  );
}

export default function BakePoolStrip({ pool }: { pool?: WorkerBakePoolStats }) {
  if (!pool) return null;
  // Pool never used yet (no bakes since boot) — say so instead of a row of zeros.
  const untouched = pool.worker === 0 && pool.inline === 0 && (pool.threads ?? 0) === 0 && pool.crashed === 0;
  // Every bake landing inline while threads served none = pool off or broken.
  const inlineOnly = pool.inline > 0 && pool.worker === 0;
  return (
    <Stack direction="row" spacing={2.25} useFlexGap sx={{ flexWrap: "wrap", alignItems: "baseline", mt: 2 }}>
      <Typography variant="overline" color="text.secondary">
        Bake threads
      </Typography>
      {untouched ? (
        <Typography variant="caption" color="text.disabled">
          no bakes since boot
        </Typography>
      ) : (
        <>
          <Stat label="live" value={pool.threads ?? "—"} title="Worker threads alive now — each a V8 isolate holding RSS until idle-recycled" />
          <Stat label="baked in thread" value={pool.worker} title="Bakes served OFF the main loop (the offload working)" />
          <Stat
            label="inline"
            value={pool.inline}
            tone={inlineOnly ? "warn" : undefined}
            title={inlineOnly ? "Every bake is running ON the main loop — pool off or broken (BAKE_POOL / crash budget)" : "Bakes that fell back to the main loop"}
          />
          <Stat label="spawned" value={pool.spawned} title="Threads started since boot" />
          <Stat
            label="recycled"
            value={pool.recycled}
            tone={pool.recycled > 0 ? "good" : undefined}
            title="Idle threads retired — their isolate memory returned to the OS"
          />
          {pool.crashed > 0 && (
            <Stat label="crashed" value={pool.crashed} tone="error" title="Threads that died mid-bake (task refunded inline) — check worker logs" />
          )}
          {(pool.queued ?? 0) > 0 && <Stat label="queued" value={pool.queued!} title="Bakes waiting for a free thread" />}
        </>
      )}
    </Stack>
  );
}
