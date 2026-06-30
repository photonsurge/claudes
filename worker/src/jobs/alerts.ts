import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { getEnabledSources, getSource } from "../alerts/registry";
import { ingestSource, type IngestResult } from "../alerts/ingest";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { ALERTS_UPDATED } from "@photonsurge/shared/control";
import { emitWorkerEvent } from "../socket";

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
      const r = await ingestSource(source, db);
      results.push(r);
      blogInfo(TAG, `${source.id}: ${r.count} alerts (+${r.inserted} new)`, r, "alerts", source.id);
    } catch (err) {
      log(TAG, `source failed`, { source: source.id, err: summarizeForLog(err) });
      blogErr(TAG, `${source.id} ingest failed`, err, "alerts", source.id);
      results.push({ source: source.id, error: String(err) });
    }
  }

  // Live push: tell browsers to refetch the overlay/list the instant ingest
  // finishes, instead of waiting out their 60s poll (mirrors TRACKS_UPDATED).
  const changed = results.reduce((n, r) => n + ("inserted" in r ? r.inserted + (r.expired ?? 0) : 0), 0);
  emitWorkerEvent({ type: ALERTS_UPDATED, data: { sources: results.length, changed } });

  log(TAG, `done`, { jobId: job.id, sources: results.length });
  return { results };
}
