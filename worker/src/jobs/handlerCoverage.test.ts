/**
 * Drift guard: every button in the /admin/jobs catalog must reach a real handler.
 *
 * The worker's loader maps a job's `type` to `worker/src/jobs/<type>.ts` and its
 * `event` to an exported function in that file (see index.ts#loadHandlers). A
 * mismatch is invisible until an operator clicks the button and the job throws
 * "No handler for event" from inside BullMQ — which is a bad place to find out.
 *
 * This reads the source rather than importing it: importing every job module
 * pulls in sharp, Redis and Mongo clients, which is the wrong price for a
 * name-matching check.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TRIGGERABLE_JOBS } from "@photonsurge/shared/jobs";

const jobsDir = join(__dirname);

/** Both shapes the loader accepts: a direct export, or a re-export from a module. */
const exportsName = (src: string, name: string): boolean =>
  new RegExp(`export\\s+(async\\s+)?(function|const|let)\\s+${name}\\b`).test(src) ||
  new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(src);

describe("every triggerable job reaches a handler", () => {
  it("has a jobs/<type>.ts module for every job type", () => {
    const missing = TRIGGERABLE_JOBS.filter((j) => !existsSync(join(jobsDir, `${j.type}.ts`))).map(
      (j) => `${j.id} -> jobs/${j.type}.ts`,
    );
    expect(missing).toEqual([]);
  });

  it("exports a handler named after every job event", () => {
    const missing: string[] = [];
    for (const j of TRIGGERABLE_JOBS) {
      const path = join(jobsDir, `${j.type}.ts`);
      if (!existsSync(path)) continue; // reported by the test above
      if (!exportsName(readFileSync(path, "utf8"), j.event)) {
        missing.push(`${j.id} -> ${j.type}.${j.event}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("pairs every destructive retention job with a dry-run twin", () => {
    // Retention deletes data, so the catalog must always offer a way to see what
    // WOULD go first (docs/blob-retention-plan.md). Pinned by id convention.
    const destructive = [
      "weather-thin-archive",
      "alerts-prune-snapshots",
      "alerts-dedup-snapshots",
      "seismic-archive",
    ];
    for (const id of destructive) {
      const real = TRIGGERABLE_JOBS.find((j) => j.id === id);
      const dry = TRIGGERABLE_JOBS.find((j) => j.id === `${id}-dry`);
      expect(real).toBeDefined();
      expect(dry).toBeDefined();
      // The twin must hit the SAME handler, differing only in its payload.
      expect(dry!.type).toBe(real!.type);
      expect(dry!.event).toBe(real!.event);
      expect(dry!.data).toMatchObject({ dryRun: true });
      expect(real!.data ?? {}).not.toMatchObject({ dryRun: true });
    }
  });

  it("keeps the orphan blob purge behind a report-only sibling", () => {
    const report = TRIGGERABLE_JOBS.find((j) => j.id === "blobs-orphans");
    const purge = TRIGGERABLE_JOBS.find((j) => j.id === "blobs-orphans-purge");
    expect(report?.data ?? {}).not.toMatchObject({ apply: true });
    expect(purge?.data).toMatchObject({ apply: true });
    expect(purge?.event).toBe(report?.event);
  });
});
