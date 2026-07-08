import { createHash } from "crypto";

/**
 * sha1 of an alert info entry's translatable text. Shared by
 * `alerts-repo.ts#upsert` (to detect whether a re-fetched bulletin's content
 * actually changed, so a stable alert doesn't lose its cached translation on
 * every re-poll) and `worker/src/alerts/translate.ts` (to skip re-translating
 * unchanged entries).
 */
export function alertContentHash(headline: string, description: string, instruction: string): string {
  return createHash("sha1").update(`${headline}|${description}|${instruction}`).digest("hex");
}
