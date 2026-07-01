import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { getEnabledCamSources, getCamSource } from "../cams/registry";
import { ingestCamSource, type CamIngestResult } from "../cams/ingest";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";

const TAG = "job:cams";

/**
 * Dispatched as type "cams", event "ingest". With `data.source` set, ingests
 * just that catalogue (one repeatable job per source — see index.ts); with no
 * source, ingests every enabled source. Each source is wrapped independently so
 * one failing/ratelimited feed never blocks the others (mirrors alerts §6). The
 * public app reads only the cached Mongo catalog — it never calls a provider.
 */
export async function ingest(job: Job) {
  const id: string | undefined = job.data?.data?.source;
  const sources = id ? [getCamSource(id)].filter(Boolean) : getEnabledCamSources();

  const db = await getAppDb();
  const results: (CamIngestResult | { source: string; error: string })[] = [];

  for (const source of sources) {
    if (!source) continue;
    try {
      const r = await ingestCamSource(source, db);
      results.push(r);
      blogInfo(TAG, `${source.id}: ${r.count} cams (+${r.upserted} new)`, r, "cams", source.id);
    } catch (err) {
      log(TAG, `source failed`, { source: source.id, err: summarizeForLog(err) });
      blogErr(TAG, `${source.id} ingest failed`, err, "cams", source.id);
      results.push({ source: source.id, error: String(err) });
    }
  }

  log(TAG, `done`, { jobId: job.id, sources: results.length });
  return { results };
}
