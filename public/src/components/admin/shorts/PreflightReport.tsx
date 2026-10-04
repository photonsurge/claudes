"use client";

/**
 * The offline test's preflight report (docs/short-video-plan.md §7.1), shown
 * in the Render form: clips resolved and skipped with their reasons, length
 * against the budget, the encoder probe and the YouTube account's state. One
 * line per check, coloured by its level; the clip lists under it.
 */
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { PreflightLevel, ShortRenderPreflight } from "@photonsurge/shared/short-render";
import { formatDuration } from "../../../lib/shorts";

const SEVERITY: Record<PreflightLevel, "success" | "warning" | "error"> = { ok: "success", warn: "warning", fail: "error" };

function Check({ level, label, children }: { level: PreflightLevel; label: string; children: React.ReactNode }) {
  return (
    <Alert severity={SEVERITY[level]} variant="outlined" sx={{ py: 0 }} aria-label={`${label}: ${level}`}>
      <Typography variant="body2" component="div">
        <strong>{label}</strong> · {children}
      </Typography>
    </Alert>
  );
}

export default function PreflightReport({ report }: { report: ShortRenderPreflight }) {
  const { script, length, encoder, youtube } = report;
  const clipsLine = script.clips.length
    ? `${script.clips.length} clip${script.clips.length === 1 ? "" : "s"} resolve${script.skipped.length ? `, ${script.skipped.length} skipped` : ""}`
    : script.note ?? "no clips";
  return (
    <Stack spacing={0.75} aria-label="Preflight report">
      <Typography variant="subtitle2">
        Preflight {report.ok ? "passed" : "found a problem"}
        {report.format ? ` · format ${report.format.name}` : ""}
      </Typography>
      <Check level={script.level} label="Clips">
        {script.title ? `“${script.title}”: ` : ""}
        {clipsLine}
        {script.clips.length > 0 && script.note ? ` — ${script.note}` : ""}
        {script.clips.length > 0 && (
          <Typography component="ol" variant="caption" sx={{ m: 0, pl: 2.5 }}>
            {script.clips.map((c) => (
              <li key={c.id}>
                {c.title} · {formatDuration(c.durationMs)}
              </li>
            ))}
          </Typography>
        )}
        {script.skipped.length > 0 && (
          <Typography component="ul" variant="caption" sx={{ m: 0, pl: 2.5 }} aria-label="Skipped clips">
            {script.skipped.map((c) => (
              <li key={c.id}>
                skipped {c.title}: {c.reason}
              </li>
            ))}
          </Typography>
        )}
      </Check>
      <Check level={length.level} label="Length">
        {length.note ?? `${formatDuration(length.playMs)} of ${formatDuration(length.budgetMs)}`}
      </Check>
      <Check level={encoder.level} label="Encoder">
        {encoder.checked.map((c) => `${c.name || c.id}: ${c.reachable ? c.detail : `unreachable — ${c.detail}`}`).join("; ")}
        {encoder.note ? `${encoder.checked.length ? " — " : ""}${encoder.note}` : ""}
      </Check>
      <Check level={youtube.level} label="YouTube">
        {youtube.accountTitle || youtube.accountId ? `${youtube.accountTitle || youtube.accountId}: ` : ""}
        {youtube.note}
      </Check>
    </Stack>
  );
}
