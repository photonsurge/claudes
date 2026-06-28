import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { getEnabledSources, getSource } from "../alerts/registry";
import { ingestSource, type IngestResult } from "../alerts/ingest";
import { summarizeForLog } from "../utils";

const TAG = "job:alerts";

/**
 * Dispatched as type "alerts", event "ingest". With `data.source` set, ingests
 * just that source (one repeatable job per source — see index.ts); with no
 * source, ingests every enabled source. Each source is wrapped independently so
 * one failing/ratelimited feed never blocks the others (spec §6).
 */
export async function ingest(job: Job) {
  const id: string | undefined = job.data?.data?.source;
  const sources = id ? [getSource(id)].filter(Boolean) : getEnabledSources();

  const db = await getAppDb();
  const results: (IngestResult | { source: string; error: string })[] = [];

  for (const source of sources) {
    if (!source) continue;
    try {
      results.push(await ingestSource(source, db));
    } catch (err) {
      log(TAG, `source failed`, { source: source.id, err: summarizeForLog(err) });
      results.push({ source: source.id, error: String(err) });
    }
  }

  log(TAG, `done`, { jobId: job.id, sources: results.length });
  return { results };
}
