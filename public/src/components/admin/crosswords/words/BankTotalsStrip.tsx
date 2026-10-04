"use client";

/**
 * The totals above the Words list: words by clue status, by validation
 * decision and by frequency band, plus the whole bank. Counted over the whole
 * bank (not the current filter), cached a minute server-side.
 */
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { BANK_ZIPF_BANDS, type BankTotals } from "@photonsurge/shared/crossword-bank";
import { BANK_CLUE_STATUSES } from "./query";

const n = (v?: number) => (v ?? 0).toLocaleString("en-GB");

/** Known keys first in their own order, then anything else the bank holds. */
function ordered(counts: Record<string, number>, known: readonly string[]): [string, number][] {
  const extra = Object.keys(counts).filter((k) => !known.includes(k)).sort();
  return [...known, ...extra].filter((k) => k in counts).map((k) => [k, counts[k]]);
}

function Group({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <Box sx={{ minWidth: 180 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        {title}
      </Typography>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          —
        </Typography>
      ) : (
        rows.map(([label, count]) => (
          <Stack key={label} direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
            <Typography variant="body2">{label}</Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {n(count)}
            </Typography>
          </Stack>
        ))
      )}
    </Box>
  );
}

export default function BankTotalsStrip({ totals }: { totals: BankTotals }) {
  const bandLabel = Object.fromEntries(BANK_ZIPF_BANDS.map((b) => [b.id, b.label]));
  const bands = ordered(totals.byBand, [...BANK_ZIPF_BANDS.map((b) => b.id), "none"]).map(
    ([k, v]) => [k === "none" ? "No score" : (bandLabel[k] ?? k), v] as [string, number],
  );
  return (
    <Paper sx={{ p: 1.75 }} aria-label="Bank totals">
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 4 }}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
            Words
          </Typography>
          <Typography variant="h2" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {n(totals.total)}
          </Typography>
        </Box>
        <Group title="Clue status" rows={ordered(totals.byClueStatus, BANK_CLUE_STATUSES)} />
        <Group title="Decision" rows={ordered(totals.byDecision, ["accepted", "review", "reject", "none"])} />
        <Group title="Frequency" rows={bands} />
      </Stack>
    </Paper>
  );
}
