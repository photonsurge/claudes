/**
 * Classify a googleapis / google-auth-library failure into the few kinds the
 * streaming code treats differently. Everything downstream (chat pacing, the slot
 * sweep, the admin "needs reconnect" chip) keys off `kind` — this is the single
 * place that knows what Google's error shapes look like, so nobody else grows
 * message regexes of their own.
 *
 * Shapes handled:
 *  - gaxios `GaxiosError` from an API call: `.status`,
 *    `.response.data.error.errors[0].reason` (`quotaExceeded`, `rateLimitExceeded`…)
 *  - gaxios error from the TOKEN endpoint: `.message === "invalid_grant"`,
 *    `.response.data.error_description` ("Token has been expired or revoked.")
 *  - transport failures: `TypeError: fetch failed` carrying a `cause.code`
 *    (undici), `TimeoutError` (our AbortSignal.timeout), `AbortError`.
 */
export type YoutubeErrorKind =
  | "quota" // the project's DAILY quota is spent (403 quotaExceeded) — resets midnight Pacific
  | "rate" // per-minute / per-user rate limit (403 rateLimitExceeded, 429) — back off briefly
  | "auth-revoked" // the refresh token is dead (invalid_grant) — the operator must reconnect
  | "auth" // 401 / bad or insufficient credentials — a refresh-and-retry may fix it
  | "timeout" // our own request timeout fired (no answer within YOUTUBE_API_TIMEOUT_MS)
  | "network" // DNS / reset / refused — transient transport failure
  | "other";

export interface YoutubeErrorInfo {
  kind: YoutubeErrorKind;
  status?: number;
  reason?: string;
  message: string;
}

const AUTH_REASONS = new Set(["authError", "invalid_token", "insufficientPermissions", "unauthorized", "authorizationRequired"]);
const TIMEOUT_CODES = new Set([
  "TimeoutError",
  "AbortError",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "ERR_STREAM_PREMATURE_CLOSE",
]);

const numeric = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** `code` / `name` strings up the `cause` chain (undici nests the real code one level down). */
function causeCodes(err: unknown): string[] {
  const out: string[] = [];
  let cur: any = err;
  for (let depth = 0; cur && depth < 4; depth++) {
    if (typeof cur.code === "string") out.push(cur.code);
    if (typeof cur.name === "string") out.push(cur.name);
    cur = cur.cause;
  }
  return out;
}

export function classifyYoutubeError(err: unknown): YoutubeErrorInfo {
  const e: any = err ?? {};
  const message = String(e?.message ?? err ?? "");
  const data: any = e?.response?.data;
  const status = numeric(e?.status) ?? numeric(e?.response?.status) ?? numeric(e?.code);
  const reason: string | undefined =
    e?.errors?.[0]?.reason ??
    data?.error?.errors?.[0]?.reason ??
    (typeof data?.error === "string" ? data.error : undefined);
  const text = [
    message,
    data?.error_description,
    typeof data?.error === "string" ? data.error : data?.error?.message,
  ]
    .filter(Boolean)
    .join(" ");
  const codes = causeCodes(err);
  const info = (kind: YoutubeErrorKind): YoutubeErrorInfo => ({ kind, status, reason, message: text || message });

  if (reason === "invalid_grant" || /invalid_grant|Token has been expired or revoked/i.test(text)) return info("auth-revoked");
  if (
    reason === "quotaExceeded" ||
    reason === "dailyLimitExceeded" ||
    /quotaExceeded|dailyLimitExceeded|exceeded your quota/i.test(text)
  ) {
    return info("quota");
  }
  if (status === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") return info("rate");
  if (status === 401 || (reason !== undefined && AUTH_REASONS.has(reason))) return info("auth");
  if (codes.some((c) => TIMEOUT_CODES.has(c))) return info("timeout");
  if (codes.some((c) => NETWORK_CODES.has(c)) || /fetch failed|socket hang up/i.test(text)) return info("network");
  return info("other");
}

/** True for failures worth a plain retry a few seconds later (nothing the operator can fix). */
export const isTransientYoutubeError = (kind: YoutubeErrorKind): boolean =>
  kind === "timeout" || kind === "network" || kind === "rate";
