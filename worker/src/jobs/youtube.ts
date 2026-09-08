/**
 * YouTube OAuth jobs, on behalf of public's admin routes (both awaited via
 * sendToQueueAndWait; `youtube` is a FOREGROUND type):
 *   youtube.exchangeCode { code, connectedBy }  ← /google/redirect callback
 *   youtube.check        { accountId? }         ← POST /api/youtube/check
 * The exchange + refresh-token encryption + token minting happen HERE, in the
 * worker, so the client secret and the AES key never enter `public`.
 */
import { UnrecoverableError, type Job } from "bullmq";
import { checkYoutubeConnection, exchangeAuthCode } from "../youtube/client";
import { streamVideoStats } from "../youtube/video-stats";

/** Admin-only audience statistics, read through the worker's existing OAuth connection. */
export async function videoStats() {
  return streamVideoStats();
}

export async function exchangeCode(job: Job) {
  const code = String(job.data?.data?.code ?? "");
  const connectedBy = job.data?.data?.connectedBy ? String(job.data.data.connectedBy) : undefined;
  if (!code) throw new UnrecoverableError("youtube.exchangeCode: missing code");
  try {
    return await exchangeAuthCode(code, connectedBy);
  } catch (err) {
    // An OAuth authorization code is SINGLE-USE: getToken() consumes it, so a retry
    // can only ever fail with `invalid_grant` — which masks the REAL first error
    // (e.g. "YouTube Data API v3 is disabled", which fails on the later channels.list
    // call AFTER the code is already spent). Make every failure terminal so the
    // genuine message propagates back to the /google/redirect caller on the first try.
    throw new UnrecoverableError((err as Error)?.message ?? String(err));
  }
}

/**
 * Admin diagnostic (POST /api/youtube/check): prove the stored refresh token
 * still mints access tokens and that one 1-unit Data API call succeeds; report
 * today's quota spend. Resolves (never rejects) with a structured result so the
 * operator sees the reason ("invalid_grant — reconnect", "quota exhausted until…").
 */
export async function check(job: Job) {
  const accountId = job.data?.data?.accountId ? String(job.data.data.accountId) : undefined;
  try {
    return await checkYoutubeConnection(accountId);
  } catch (err) {
    return { ok: false, configured: true, tokenOk: false, apiOk: false, apiTimeoutMs: 0, error: String((err as Error)?.message ?? err) };
  }
}
