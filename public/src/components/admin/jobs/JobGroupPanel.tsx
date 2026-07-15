"use client";

/**
 * One group of jobs on /admin/jobs — a panel holding its own card grid, which
 * then sits in the page's outer grid of panels. Big groups (Volcanoes, Weather
 * maps) claim a wider panel so their cards lay out in rows; a one-job group
 * takes a single column instead of an empty full-width band, and the outer
 * grid's dense flow packs those small panels into the gaps.
 */
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
    <section
      className={`job-panel job-span-${spanForCount(jobs.length)}`}
      style={{
        padding: 16,
        borderRadius: 10,
        // Panels sit side by side now, so each needs a visible edge of its own.
        border: "1px solid #2a3446",
        background: "#070b12",
      }}
    >
      <h3
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "0 0 14px",
          paddingBottom: 10,
          borderBottom: "1px solid #2a3446",
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: 0.2,
          color: "#dfe7f5",
        }}
      >
        {group}
        <span style={{ color: "#5b6577", fontSize: 13, fontWeight: 400 }}>{jobs.length}</span>
      </h3>

      <div
        style={{
          display: "grid",
          gap: 12,
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
      </div>
    </section>
  );
}
