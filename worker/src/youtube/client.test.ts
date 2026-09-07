/**
 * The guarded call path: auth client options (auto-refresh + retry-on-401 +
 * timeouts), quota metering + the exhausted block, invalid_grant → cache
 * eviction + authError stamp, and the admin connection check.
 */
process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
process.env.GOOGLE_OAUTH_SECRET = "sec";
process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost/google/redirect";

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => ({})) }));
jest.mock("@photonsurge/shared/utill/secretbox", () => ({
  decryptSecret: () => "refresh-token",
  encryptSecret: (s: string) => `enc:${s}`,
}));

const api = {
  channels: { list: jest.fn() },
  liveStreams: { list: jest.fn() },
  liveChatMessages: { list: jest.fn() },
};
const oauthInstances: any[] = [];
const youtubeFactoryOpts: any[] = [];
jest.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(function (this: any, opts: any) {
        this.opts = opts;
        this.credentials = {};
        this.setCredentials = (c: any) => {
          this.credentials = { ...this.credentials, ...c };
        };
        this.on = jest.fn();
        this.getAccessToken = jest.fn(async () => {
          this.credentials.expiry_date = Date.now() + 3_600_000;
          return { token: "access" };
        });
        oauthInstances.push(this);
      }),
    },
    youtube: jest.fn((opts: any) => {
      youtubeFactoryOpts.push(opts);
      return api;
    }),
  },
}));

const account: any = { id: "chan", refreshTokenEnc: "enc:refresh-token", authError: null };
const db = {
  getYoutubeAccount: jest.fn(async () => account),
  saveYoutubeAccount: jest.fn(async () => null),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import {
  YoutubeAuthRevokedError,
  YoutubeQuotaExceededError,
  checkYoutubeConnection,
  clearYoutubeClient,
  getStreamStatus,
  getYoutubeClient,
  youtubeErrorKind,
} from "./client";
import { MemoryQuotaStore, exhaustedUntil, setQuotaStore, spentToday } from "./quota";

const flush = () => new Promise((r) => setImmediate(r));
const quotaErr = () =>
  Object.assign(new Error("The request cannot be completed because you have exceeded your quota."), {
    status: 403,
    response: { status: 403, data: { error: { errors: [{ reason: "quotaExceeded" }] } } },
  });
const invalidGrant = () =>
  Object.assign(new Error("invalid_grant"), {
    response: { status: 400, data: { error: "invalid_grant", error_description: "Token has been expired or revoked." } },
  });

beforeEach(() => {
  setQuotaStore(new MemoryQuotaStore());
  clearYoutubeClient("chan");
  oauthInstances.length = 0;
  youtubeFactoryOpts.length = 0;
  account.authError = null;
  db.saveYoutubeAccount.mockClear();
  api.liveStreams.list.mockReset().mockResolvedValue({ data: { items: [{ status: { streamStatus: "active", healthStatus: { status: "good" } } }] } });
  api.channels.list.mockReset().mockResolvedValue({ data: { items: [{ id: "chan", snippet: { title: "G.O.D.S." } }] } });
});

it("builds the auth client to auto-refresh, retry once on 401/403, and never hang", async () => {
  const ctx = await getYoutubeClient();
  expect(oauthInstances[0].opts).toMatchObject({ clientId: "cid", clientSecret: "sec", forceRefreshOnFailure: true });
  expect(oauthInstances[0].opts.transporterOptions.timeout).toBeGreaterThan(0);
  expect(oauthInstances[0].credentials.refresh_token).toBe("refresh-token");
  expect(youtubeFactoryOpts[0].timeout).toBeGreaterThan(0);
  expect(ctx.accountId).toBe("chan");
  // Cached: a second lookup reuses the same client (and its minted access token).
  expect(await getYoutubeClient()).toBe(ctx);
  expect(oauthInstances).toHaveLength(1);
});

it("meters every successful call against the day's quota", async () => {
  const ctx = await getYoutubeClient();
  expect(await getStreamStatus(ctx, "strm")).toEqual({ streamStatus: "active", health: "good" });
  await flush();
  expect(await spentToday("chan")).toBe(1); // liveStreams.list = 1 unit
});

it("a quotaExceeded verdict blocks further calls until the reset WITHOUT hitting the API", async () => {
  const ctx = await getYoutubeClient();
  api.liveStreams.list.mockRejectedValueOnce(quotaErr());
  await expect(getStreamStatus(ctx, "strm")).rejects.toBeInstanceOf(YoutubeQuotaExceededError);
  const until = await exhaustedUntil("chan");
  expect(until).toBeGreaterThan(Date.now());
  await expect(getStreamStatus(ctx, "strm")).rejects.toBeInstanceOf(YoutubeQuotaExceededError);
  expect(api.liveStreams.list).toHaveBeenCalledTimes(1);
  await flush();
  expect(await spentToday("chan")).toBe(1); // the failed call was billed, the blocked one wasn't made
});

it("invalid_grant evicts the cached client and stamps authError on the account", async () => {
  const ctx = await getYoutubeClient();
  api.liveStreams.list.mockRejectedValueOnce(invalidGrant());
  await expect(getStreamStatus(ctx, "strm")).rejects.toBeInstanceOf(YoutubeAuthRevokedError);
  expect(db.saveYoutubeAccount).toHaveBeenCalledWith(
    expect.objectContaining({ id: "chan", authError: expect.objectContaining({ kind: "auth-revoked" }) }),
  );
  // Next caller gets a FRESH client (a reconnect replaces the token doc).
  const again = await getYoutubeClient();
  expect(again).not.toBe(ctx);
  expect(oauthInstances).toHaveLength(2);
});

it("a success after a recorded authError clears it (and stamps lastOkAt)", async () => {
  account.authError = { kind: "auth-revoked", message: "old", at: 1 };
  const ctx = await getYoutubeClient();
  await getStreamStatus(ctx, "strm");
  await flush();
  expect(db.saveYoutubeAccount).toHaveBeenCalledWith(
    expect.objectContaining({ id: "chan", authError: null, lastOkAt: expect.any(Number) }),
  );
});

it("annotates other failures with the op and a kind", async () => {
  const ctx = await getYoutubeClient();
  api.liveStreams.list.mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }));
  const err = await getStreamStatus(ctx, "strm").catch((e) => e);
  expect(err.message).toMatch(/^liveStreams\.list: fetch failed/);
  expect(youtubeErrorKind(err)).toBe("network");
});

describe("checkYoutubeConnection", () => {
  it("reports token + API ok with the quota snapshot", async () => {
    const res = await checkYoutubeConnection();
    expect(res).toMatchObject({ ok: true, tokenOk: true, apiOk: true, accountId: "chan", channelTitle: "G.O.D.S." });
    expect(res.tokenExpiresAt).toBeGreaterThan(Date.now());
    expect(res.quota).toMatchObject({ budget: 10_000, exhaustedUntil: null });
    expect(res.quota!.spent).toBe(1); // the channels.list probe
  });

  it("reports a dead refresh token without spending API quota", async () => {
    await getYoutubeClient();
    oauthInstances[0].getAccessToken.mockRejectedValueOnce(invalidGrant());
    const res = await checkYoutubeConnection();
    expect(res).toMatchObject({ ok: false, tokenOk: false, apiOk: false, kind: "auth-revoked" });
    expect(res.error).toMatch(/reconnect the channel/);
    expect(api.channels.list).not.toHaveBeenCalled();
    expect(db.saveYoutubeAccount).toHaveBeenCalledWith(expect.objectContaining({ authError: expect.anything() }));
  });

  it("reports an exhausted quota with the token still fine", async () => {
    const ctx = await getYoutubeClient();
    api.liveStreams.list.mockRejectedValueOnce(quotaErr());
    await getStreamStatus(ctx, "strm").catch(() => {});
    const res = await checkYoutubeConnection();
    expect(res).toMatchObject({ ok: false, tokenOk: true, apiOk: false, kind: "quota" });
    expect(res.quota!.exhaustedUntil).toBeGreaterThan(Date.now());
    expect(api.channels.list).not.toHaveBeenCalled();
  });
});
