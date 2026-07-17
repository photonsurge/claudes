"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { font } from "../../theme/tokens";
import type { WorkerEventStat } from "../../lib/worker-stats";

/**
 * Per-event memory + timing ledger — "which job type grows the heap most / runs
 * longest / errors" as a sortable table, the thing the operator asked for ("events
 * should have their own log usage mem"). One row per job label (type.event, or
 * type.event:source). The peak-heap column carries an inline bar so the heavy
 * hitters read as a shape, not just a number.
 */
type SortKey = keyof Pick<
  WorkerEventStat,
  "label" | "runs" | "errors" | "avgMs" | "peakMs" | "peakHeapDeltaMB" | "peakRssMB"
>;

const COLS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "label", label: "event", numeric: false },
  { key: "runs", label: "runs", numeric: true },
  { key: "errors", label: "err", numeric: true },
  { key: "avgMs", label: "avg", numeric: true },
  { key: "peakMs", label: "peak ms", numeric: true },
  { key: "peakHeapDeltaMB", label: "peak heap Δ", numeric: true },
  { key: "peakRssMB", label: "peak rss", numeric: true },
];

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export default function EventUsageTable({ events, activeLabels = [] }: { events: WorkerEventStat[]; activeLabels?: string[] }) {
  const [sort, setSort] = useState<SortKey>("peakHeapDeltaMB");
  const [asc, setAsc] = useState(false);
  const running = new Set(activeLabels);

  const rows = [...events].sort((a, b) => {
    const av = a[sort];
    const bv = b[sort];
    const cmp = typeof av === "string" ? String(av).localeCompare(String(bv)) : (av as number) - (bv as number);
    return asc ? cmp : -cmp;
  });
  const maxHeap = Math.max(1, ...events.map((e) => e.peakHeapDeltaMB));

  const onSort = (key: SortKey) => {
    if (key === sort) setAsc((v) => !v);
    else {
      setSort(key);
      setAsc(key === "label"); // names default A→Z, numbers default high→low
    }
  };

  const cellSx = { px: 1, py: 0.75, fontVariantNumeric: "tabular-nums" as const };

  if (events.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: "center", color: "text.disabled", border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
        No events recorded yet — the worker logs each job's memory as it runs.
      </Box>
    );
  }

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <Box component="thead">
          <Box component="tr" sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
            {COLS.map((c) => {
              const active = c.key === sort;
              return (
                <Box
                  component="th"
                  key={c.key}
                  onClick={() => onSort(c.key)}
                  sx={{
                    ...cellSx,
                    textAlign: c.numeric ? "right" : "left",
                    cursor: "pointer",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                    color: active ? "primary.main" : "text.secondary",
                    fontWeight: 600,
                    "&:hover": { color: "text.primary" },
                  }}
                >
                  {c.label}
                  {active ? (asc ? " ▲" : " ▼") : ""}
                </Box>
              );
            })}
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map((e) => {
            const [type] = e.label.split(".");
            return (
              <Box
                component="tr"
                key={e.label}
                sx={{ borderBottom: "1px solid", borderColor: "divider", "&:hover": { bgcolor: "action.hover" } }}
              >
                <Box component="td" sx={{ ...cellSx, fontFamily: font.mono }}>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                    {/* Live dot when this event type is running right now. */}
                    <Box
                      component="span"
                      title={running.has(e.label) ? "running now" : undefined}
                      sx={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        flexShrink: 0,
                        bgcolor: running.has(e.label) ? "success.main" : "transparent",
                        boxShadow: running.has(e.label) ? "0 0 0 3px rgba(34,197,94,0.18)" : "none",
                      }}
                    />
                    <Box component="span" sx={{ color: "text.disabled" }}>
                      {type}.
                    </Box>
                    <Box component="span" sx={{ color: "text.primary" }}>
                      {e.label.slice(type.length + 1)}
                    </Box>
                  </Stack>
                </Box>
                <Box component="td" sx={{ ...cellSx, textAlign: "right", color: "text.secondary" }}>
                  {e.runs}
                </Box>
                <Box component="td" sx={{ ...cellSx, textAlign: "right", color: e.errors > 0 ? "error.main" : "text.disabled" }}>
                  {e.errors || "—"}
                </Box>
                <Box component="td" sx={{ ...cellSx, textAlign: "right", color: "text.secondary" }}>
                  {fmtMs(e.avgMs)}
                </Box>
                <Box component="td" sx={{ ...cellSx, textAlign: "right", color: "text.secondary" }}>
                  {fmtMs(e.peakMs)}
                </Box>
                <Box component="td" sx={{ ...cellSx, textAlign: "right", minWidth: 130 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "flex-end" }}>
                    <Box sx={{ position: "relative", flex: 1, maxWidth: 80, height: 6, borderRadius: 1, bgcolor: "action.hover" }}>
                      <Box
                        sx={{
                          position: "absolute",
                          inset: 0,
                          width: `${(e.peakHeapDeltaMB / maxHeap) * 100}%`,
                          borderRadius: 1,
                          bgcolor: e.peakHeapDeltaMB >= maxHeap * 0.66 ? "warning.main" : "primary.main",
                        }}
                      />
                    </Box>
                    <Box component="span" sx={{ minWidth: 44, textAlign: "right", fontWeight: 600 }}>
                      {e.peakHeapDeltaMB}MB
                    </Box>
                  </Stack>
                </Box>
                <Box component="td" sx={{ ...cellSx, textAlign: "right", color: "text.secondary" }}>
                  {e.peakRssMB}MB
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
