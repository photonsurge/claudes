"use client";

/**
 * The approved-pool counter (§7.4): approved words, the family-friendly ones,
 * and how many puzzles that supports without a repeat, against the first
 * target (about 300 words). Shown on the Words list and in the approval queue.
 */
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { BankPoolCounts } from "@photonsurge/shared/crossword-bank";

const n = (v: number) => v.toLocaleString("en-GB");

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Typography variant="h3" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

export default function PoolCounter({ pool, dense }: { pool: BankPoolCounts; dense?: boolean }) {
  const pct = Math.min(100, Math.round((pool.words / pool.targetWords) * 100));
  return (
    <Paper sx={{ p: dense ? 1.25 : 1.75 }} aria-label="Approved pool">
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: dense ? 3 : 4, alignItems: "flex-end" }}>
        <Stat label="Approved words" value={n(pool.words)} hint={`of ${n(pool.targetWords)} to fill the no-repeat window`} />
        <Stat label="Family friendly" value={n(pool.ffWords)} />
        <Stat label="Puzzles, no repeat" value={n(pool.puzzlesWithoutRepeat)} hint={`${n(pool.ffPuzzlesWithoutRepeat)} family friendly`} />
        <Box sx={{ flex: "1 1 160px", minWidth: 140 }}>
          <LinearProgress variant="determinate" value={pct} aria-label="Progress to the pool target" />
        </Box>
      </Stack>
    </Paper>
  );
}
