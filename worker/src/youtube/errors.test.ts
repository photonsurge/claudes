/**
 * The classifier is the one place that knows Google's error shapes; everything
 * downstream keys off `kind`. Each case below is a shape seen in the wild.
 */
import { classifyYoutubeError, isTransientYoutubeError } from "./errors";

const gaxios = (status: number, reason: string, message = "boom") =>
  Object.assign(new Error(message), {
    status,
    response: { status, data: { error: { code: status, message, errors: [{ reason, domain: "youtube.quota" }] } } },
  });

it("spots a spent daily quota (403 quotaExceeded)", () => {
  const info = classifyYoutubeError(
    gaxios(403, "quotaExceeded", "The request cannot be completed because you have exceeded your quota."),
  );
  expect(info).toMatchObject({ kind: "quota", status: 403, reason: "quotaExceeded" });
});

it("treats a rate limit as transient, not as a spent quota", () => {
  expect(classifyYoutubeError(gaxios(403, "rateLimitExceeded")).kind).toBe("rate");
  expect(classifyYoutubeError(gaxios(429, "userRateLimitExceeded")).kind).toBe("rate");
});

it("recognises a dead refresh token from the token endpoint", () => {
  const err = Object.assign(new Error("invalid_grant"), {
    response: { status: 400, data: { error: "invalid_grant", error_description: "Token has been expired or revoked." } },
  });
  const info = classifyYoutubeError(err);
  expect(info.kind).toBe("auth-revoked");
  expect(info.message).toMatch(/expired or revoked/);
});

it("classifies 401s and credential reasons as auth (retryable after a refresh)", () => {
  expect(classifyYoutubeError(gaxios(401, "authError")).kind).toBe("auth");
  expect(classifyYoutubeError(gaxios(403, "insufficientPermissions")).kind).toBe("auth");
});

it("maps our own timeout and undici transport failures", () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  expect(classifyYoutubeError(timeout).kind).toBe("timeout");
  const headers = Object.assign(new Error("fetch failed"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } });
  expect(classifyYoutubeError(headers).kind).toBe("timeout");
  const reset = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  expect(classifyYoutubeError(reset).kind).toBe("network");
  expect(classifyYoutubeError(new Error("socket hang up")).kind).toBe("network");
});

it("does NOT read a bare word as a verdict — only Google's reasons/messages count", () => {
  expect(classifyYoutubeError(new Error("quota")).kind).toBe("other");
  expect(classifyYoutubeError(gaxios(403, "forbidden", "liveStreamingNotEnabled")).kind).toBe("other");
  expect(classifyYoutubeError(undefined).kind).toBe("other");
});

it("names the transient kinds", () => {
  expect(isTransientYoutubeError("timeout")).toBe(true);
  expect(isTransientYoutubeError("network")).toBe(true);
  expect(isTransientYoutubeError("rate")).toBe(true);
  expect(isTransientYoutubeError("quota")).toBe(false);
  expect(isTransientYoutubeError("auth-revoked")).toBe(false);
});
