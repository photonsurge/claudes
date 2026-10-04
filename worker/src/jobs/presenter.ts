/**
 * Presenter voice audition (docs/presenter-plan.md, WP5). Both handlers run
 * only when the admin page asks: there is no schedule.
 *
 *   presenter.test          { testId }  speak one bench take
 *   presenter.refreshVoices {}          refresh the cached speech-model list
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { refreshSpeechCatalog, runVoiceTest } from "../presenter/bench";

const TAG = "job:presenter";

export async function test(job: Job) {
  const testId = String(job.data?.testId ?? "");
  if (!testId) throw new Error("presenter.test needs a testId");
  const take = await runVoiceTest(await getAppDb(), testId);
  log(TAG, `test ${testId}: ${take?.status ?? "missing"}`, take?.error ? { error: take.error } : take?.audio);
  return { testId, status: take?.status ?? "missing", error: take?.error };
}

export async function refreshVoices(_job: Job) {
  const res = await refreshSpeechCatalog(await getAppDb());
  log(TAG, `speech catalog: ${res.models} models, ${res.voices} voices`);
  return res;
}
