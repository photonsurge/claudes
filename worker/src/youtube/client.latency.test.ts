/**
 * `createBroadcast`'s latency preference (crossword plan §6.3): asked for, it
 * goes out as `contentDetails.latencyPreference`; not asked for, the request
 * carries none and YouTube keeps its default.
 */
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => ({ saveYoutubeAccount: jest.fn() })) }));
jest.mock("./quota", () => ({
  exhaustedUntil: jest.fn(async () => null),
  spend: jest.fn(async () => {}),
  markExhausted: jest.fn(async () => {}),
  nextPacificMidnight: jest.fn(() => 0),
  fmtResetTime: jest.fn(() => ""),
  quotaSnapshot: jest.fn(async () => null),
}));

import { createBroadcast, type YoutubeCtx } from "./client";

const insert = jest.fn(async () => ({ data: { id: "b1" } }));
const ctx = { youtube: { liveBroadcasts: { insert } }, accountId: "acc", channelId: "acc" } as unknown as YoutubeCtx;
const base = { title: "t", privacy: "unlisted" as const, scheduledStartTime: "2026-10-05T00:00:00Z", monitorStream: false };

beforeEach(() => insert.mockClear());

it("sends latencyPreference when asked for low latency", async () => {
  await createBroadcast(ctx, { ...base, latency: "low" });
  const body = (insert.mock.calls[0] as any[])[0].requestBody;
  expect(body.contentDetails.latencyPreference).toBe("low");
});

it("sends none by default", async () => {
  await createBroadcast(ctx, base);
  const body = (insert.mock.calls[0] as any[])[0].requestBody;
  expect(body.contentDetails).not.toHaveProperty("latencyPreference");
});
