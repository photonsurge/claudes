/**
 * YouTube OAuth token exchange, on behalf of the public /google/redirect
 * route. Dispatched as `youtube.exchangeCode { code, connectedBy }` and awaited by
 * the callback (sendToQueueAndWait). The exchange + refresh-token encryption happen
 * HERE, in the worker, so the client secret and the AES key never enter `public`.
 */
import { UnrecoverableError, type Job } from "bullmq";
import { exchangeAuthCode } from "../youtube/client";

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
