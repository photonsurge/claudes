/**
 * The job card's two pure helpers, and the card's own states.
 *
 * `fmtDuration` and `resultLine` are what an operator reads to decide whether a
 * job they just kicked is fine, slow, or broken — worth pinning at the
 * boundaries, since jobs here legitimately run from 200ms to several minutes.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import type { TriggerableJob } from "@photonsurge/shared/jobs";
import { adminTheme } from "../../../theme/adminTheme";
import JobCard, { fmtDuration, resultLine, type Result } from "./JobCard";

describe("fmtDuration", () => {
  it("shows sub-second work in whole ms", () => {
    expect(fmtDuration(0)).toBe("0ms");
    expect(fmtDuration(840)).toBe("840ms");
    expect(fmtDuration(999)).toBe("999ms");
  });

  it("switches to tenths of a second at 1s", () => {
    expect(fmtDuration(1000)).toBe("1.0s");
    expect(fmtDuration(3200)).toBe("3.2s");
    expect(fmtDuration(27_000)).toBe("27.0s");
  });

  it("switches to minutes at 1m", () => {
    expect(fmtDuration(60_000)).toBe("1m0s");
    expect(fmtDuration(64_000)).toBe("1m4s");
    expect(fmtDuration(347_000)).toBe("5m47s"); // the alert-blob rebuild, before it was fixed
  });

  it("rolls up to the next minute rather than showing 60 seconds", () => {
    // Two ways the seconds could read as 60 and neither is a time:
    // 59_999ms rounds to "60.0s" on the way IN to the minutes branch, and
    // 119_500ms rounds its remainder up to 60 on the way OUT.
    expect(fmtDuration(59_999)).toBe("1m0s");
    expect(fmtDuration(119_500)).toBe("2m0s");
  });

  it("keeps the last tenth below the rollover", () => {
    // The boundary has to move with the rounding, or 59.9s disappears.
    expect(fmtDuration(59_949)).toBe("59.9s");
  });

  it("counts past an hour without inventing an hours unit", () => {
    // These jobs can run long; minutes keep climbing rather than wrapping to 0.
    expect(fmtDuration(3_599_000)).toBe("59m59s");
    expect(fmtDuration(3_600_000)).toBe("60m0s");
  });
});

describe("resultLine", () => {
  const at = "2026-07-16T09:00:00Z";

  it("leads with the error when the trigger itself failed", () => {
    // Never reached the queue — no state, no duration to report.
    expect(resultLine({ ok: false, error: "queue unreachable", at })).toEqual({
      text: "failed: queue unreachable",
      color: "error.main",
    });
  });

  it("reports a completed job with its duration", () => {
    expect(resultLine({ ok: true, state: "completed", durationMs: 3200, at })).toEqual({
      text: "done in 3.2s",
      color: "success.main",
    });
  });

  it("still says done when the duration never came back", () => {
    expect(resultLine({ ok: true, state: "completed", durationMs: null, at })).toMatchObject({ text: "done" });
  });

  it("gives the reason a job failed, not just that it did", () => {
    expect(resultLine({ ok: true, state: "failed", durationMs: 1000, failedReason: "no run yet", at })).toEqual({
      text: "failed after 1.0s: no run yet",
      color: "error.main",
    });
  });

  it("marks a failure with no reason or duration rather than rendering undefined", () => {
    expect(resultLine({ ok: true, state: "failed", at })).toMatchObject({ text: "failed after ?" });
  });

  it("shows a running job in warning colour with a live clock", () => {
    expect(resultLine({ ok: true, state: "active", durationMs: 27_000, at })).toEqual({
      text: "running… 27.0s",
      color: "warning.main",
    });
  });

  it("falls back to queued before the first poll lands", () => {
    // No state yet — the job is enqueued and we haven't looked it up.
    expect(resultLine({ ok: true, jobId: "42", at })).toEqual({
      text: "queued (#42)",
      color: "text.secondary",
    });
  });

  it("treats a reaped job as queued rather than as an error", () => {
    // Admin jobs are kept 1h; past that BullMQ has no record and reports
    // "unknown". That's not a failure and must not read as one.
    expect(resultLine({ ok: true, state: "unknown", jobId: "42", at })).toEqual({
      text: "queued (#42)",
      color: "text.secondary",
    });
  });
});

describe("JobCard", () => {
  const job = (extra: Partial<TriggerableJob> = {}) =>
    ({
      id: "weather-check",
      label: "Check weather run",
      description: "Look for a newer GFS run and bake it.",
      group: "Weather maps",
      domain: "d",
      type: "t",
      event: "e",
      ...extra,
    }) as TriggerableJob;

  // Under the real theme: the card reads `primary.main` and `divider` off it, so
  // an unthemed render would only ever prove MUI's default blue is MUI's default.
  const setup = (props: Partial<React.ComponentProps<typeof JobCard>> = {}) => {
    const onRun = jest.fn();
    const onStop = jest.fn();
    const out = render(
      <ThemeProvider theme={adminTheme}>
        <JobCard job={job()} running={false} stopping={false} onRun={onRun} onStop={onStop} {...props} />
      </ThemeProvider>,
    );
    return { ...out, onRun, onStop };
  };

  it("shows the operating caveats in full, not behind a hover", () => {
    // Several descriptions carry real warnings ("run the dry run first") and an
    // operator about to reseed a collection has to see them.
    setup({ job: job({ description: "Drops the collection. Run the dry run first." }) });

    expect(screen.getByText("Drops the collection. Run the dry run first.")).toBeVisible();
  });

  it("runs the job when asked", () => {
    const { onRun } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Run now" }));

    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("blocks a second trigger while one is in flight", () => {
    const { onRun } = setup({ running: true });

    const button = screen.getByRole("button", { name: "…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("only offers Stop on a stoppable job", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();

    setup({ job: job({ stoppable: true } as Partial<TriggerableJob>) });
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("stops the job when asked, then blocks a second stop", () => {
    const { onStop } = setup({ job: job({ stoppable: true } as Partial<TriggerableJob>) });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);

    setup({ job: job({ stoppable: true } as Partial<TriggerableJob>), stopping: true });
    expect(screen.getAllByRole("button", { name: "…" }).at(-1)).toBeDisabled();
  });

  it("reports how many batches a stop actually removed", () => {
    setup({ stopResult: { ok: true, removed: 3, at: "2026-07-16T09:00:00Z" } });

    expect(screen.getByText(/stopped — 3 queued batch\(es\) removed/)).toBeInTheDocument();
  });

  it("says zero rather than nothing when a stop found no batches", () => {
    setup({ stopResult: { ok: true, at: "2026-07-16T09:00:00Z" } });

    expect(screen.getByText(/stopped — 0 queued batch\(es\) removed/)).toBeInTheDocument();
  });

  it("surfaces a failed stop as an error", () => {
    setup({ stopResult: { ok: false, error: "not running", at: "2026-07-16T09:00:00Z" } });

    expect(screen.getByText(/failed: not running/)).toBeInTheDocument();
  });

  it("carries no result row until the job has been triggered", () => {
    const { container } = setup();

    expect(container.querySelectorAll(".MuiTypography-caption")).toHaveLength(0);
  });

  /*
   * Not tested here: the accent border a running card gets. It comes from
   * `sx.borderColor`, which emotion inserts through the CSSOM — under jsdom the
   * stylesheet text is empty and `var(--adm-palette-primary-main)` never
   * resolves, so the colour simply isn't observable without reaching into
   * emotion's internals. `resultLine`'s "active → warning.main" above is the
   * same intent pinned where it can actually be asserted.
   */

  it("shows a running job's live duration on the card", () => {
    const running: Result = { ok: true, state: "active", durationMs: 27_000, at: "2026-07-16T09:00:00Z" };
    setup({ result: running });

    expect(screen.getByText(/running… 27\.0s/)).toBeInTheDocument();
  });
});
