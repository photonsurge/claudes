/**
 * YouTube OAuth token exchange, on behalf of the public /api/youtube/callback
 * route. Dispatched as `youtube.exchangeCode { code, connectedBy }` and awaited by
 * the callback (sendToQueueAndWait). The exchange + refresh-token encryption happen
 * HERE, in the worker, so the client secret and the AES key never enter `public`.
 */
import type { Job } from "bullmq";
import { exchangeAuthCode } from "../youtube/client";

export async function exchangeCode(job: Job) {
  const code = String(job.data?.data?.code ?? "");
  const connectedBy = job.data?.data?.connectedBy ? String(job.data.data.connectedBy) : undefined;
  if (!code) throw new Error("youtube.exchangeCode: missing code");
  return exchangeAuthCode(code, connectedBy);
}
