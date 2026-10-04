"use client";

/** Small chips shared by the Words list and detail: clue status, decision, flags, frequency. */
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import { BANK_ZIPF_BANDS, zipfBand, type BankWordRow } from "@photonsurge/shared/crossword-bank";

type ChipColor = "default" | "success" | "warning" | "error" | "info";

const STATUS_COLOR: Record<string, ChipColor> = { pending: "default", done: "success", rejected: "warning", failed: "error" };
const DECISION_COLOR: Record<string, ChipColor> = { accepted: "success", review: "warning", reject: "error" };

export function ClueStatusChip({ status }: { status?: string }) {
  if (!status) return <span>—</span>;
  return <Chip size="small" label={status} color={STATUS_COLOR[status] ?? "default"} variant="outlined" />;
}

export function DecisionChip({ decision, by }: { decision?: string; by?: string }) {
  if (!decision) return <span>—</span>;
  const label = by === "operator" ? `${decision} (operator)` : decision;
  return <Chip size="small" label={label} color={DECISION_COLOR[decision] ?? "default"} variant="outlined" />;
}

export function FlagChips({ flags }: { flags: BankWordRow["flags"] }) {
  const on = (["adult", "vulgar", "offensive"] as const).filter((k) => flags[k]);
  if (!on.length) return <span>—</span>;
  return (
    <Stack direction="row" spacing={0.5}>
      {on.map((k) => (
        <Chip key={k} size="small" label={k} color="error" />
      ))}
    </Stack>
  );
}

/** "4.21 · Common" — the Zipf score and its band. */
export function zipfLabel(z?: number): string {
  if (typeof z !== "number") return "—";
  const band = BANK_ZIPF_BANDS.find((b) => b.id === zipfBand(z));
  return `${z.toFixed(2)}${band ? ` · ${band.label.replace(/ \(.*\)$/, "")}` : ""}`;
}

export const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};
