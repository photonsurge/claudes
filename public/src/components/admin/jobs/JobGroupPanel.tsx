"use client";

/**
 * One group of jobs on /admin/jobs — a panel holding its own card grid, which
 * then sits in the page's outer grid of panels. Big groups (Volcanoes, Weather
 * maps) claim a wider panel so their cards lay out in rows; a one-job group
 * takes a single column instead of an empty full-width band, and the outer
 * grid's dense flow packs those small panels into the gaps.
 */
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { TriggerableJob } from "@photonsurge/shared/jobs";
import JobCard, { type Result, type StopResult } from "./JobCard";

/** Outer-grid columns a group claims, by how many jobs it holds. */
export function spanForCount(n: number): number {
  if (n >= 12) return 4;
  if (n >= 6) return 3;
  if (n >= 3) return 2;
  return 1;
}

interface JobGroupPanelProps {
  group: string;
  jobs: TriggerableJob[];
  results: Record<string, Result>;
  stopResults: Record<string, StopResult>;
  busy: string | null;
  stopping: string | null;
  onRun: (id: string) => void;
  onStop: (job: TriggerableJob) => void;
}

export default function JobGroupPanel({
  group,
  jobs,
  results,
  stopResults,
  busy,
  stopping,
  onRun,
  onStop,
}: JobGroupPanelProps) {
  return (
    <Paper className={`job-panel job-span-${spanForCount(jobs.length)}`} sx={{ p: 2 }}>
      <Typography
        variant="h2"
        component="h3"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          mb: 1.75,
          pb: 1.25,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        {group}
        <Typography component="span" variant="caption" color="text.disabled">
          {jobs.length}
        </Typography>
      </Typography>

      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
          alignItems: "stretch",
        }}
      >
        {jobs.map((j) => (
          <JobCard
            key={j.id}
            job={j}
            result={results[j.id]}
            stopResult={stopResults[j.id]}
            running={busy === j.id}
            stopping={stopping === j.id}
            onRun={() => onRun(j.id)}
            onStop={() => onStop(j)}
          />
        ))}
      </Box>
    </Paper>
  );
}
