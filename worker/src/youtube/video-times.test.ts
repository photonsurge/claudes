import { newVideoTimes, stampVideoTimes, videoLiveTimes } from "./video-times";
import type { Run } from "@photonsurge/shared/runs";

const run = (yt: Partial<NonNullable<Run["platforms"]["youtube"]>> = {}): Run => ({
  id: "r1",
  sceneId: "default",
  status: "ended",
  platforms: { youtube: { broadcastId: "v1", streamName: "secret", ...yt }, twitch: { channelLogin: "x", chatOnly: true } },
});

const START = "2026-09-01T10:00:03.000Z";
const END = "2026-09-01T11:00:00.000Z";

describe("videoLiveTimes", () => {
  it("parses the instants YouTube has set and omits the rest", () => {
    expect(videoLiveTimes({ liveStreamingDetails: { actualStartTime: START } })).toEqual({
      actualStartTime: Date.parse(START),
    });
    expect(videoLiveTimes({ liveStreamingDetails: { actualStartTime: START, actualEndTime: END } })).toEqual({
      actualStartTime: Date.parse(START),
      actualEndTime: Date.parse(END),
    });
    expect(videoLiveTimes({ liveStreamingDetails: { actualStartTime: "junk" } })).toEqual({});
    expect(videoLiveTimes(undefined)).toEqual({});
  });
});

describe("newVideoTimes", () => {
  it("returns only what the run lacks, and null when nothing is new", () => {
    const times = { actualStartTime: Date.parse(START), actualEndTime: Date.parse(END) };
    expect(newVideoTimes(run(), times)).toEqual(times);
    expect(newVideoTimes(run({ actualStartTime: Date.parse(START) }), times)).toEqual({ actualEndTime: Date.parse(END) });
    expect(newVideoTimes(run(times), times)).toBeNull();
    expect(newVideoTimes(run(), {})).toBeNull();
  });
});

describe("stampVideoTimes", () => {
  it("writes the whole platforms block back so the stream key and other bindings survive $set", async () => {
    const updateRun = jest.fn(async () => null);
    const ok = await stampVideoTimes({ updateRun }, run(), { liveStreamingDetails: { actualStartTime: START } });
    expect(ok).toBe(true);
    expect(updateRun).toHaveBeenCalledWith("r1", {
      platforms: {
        youtube: { broadcastId: "v1", streamName: "secret", actualStartTime: Date.parse(START) },
        twitch: { channelLogin: "x", chatOnly: true },
      },
    });
  });

  it("skips the write when nothing changed and swallows db errors", async () => {
    const updateRun = jest.fn(async () => {
      throw new Error("mongo down");
    });
    expect(await stampVideoTimes({ updateRun }, run({ actualStartTime: Date.parse(START) }), { liveStreamingDetails: { actualStartTime: START } })).toBe(false);
    expect(updateRun).not.toHaveBeenCalled();
    expect(await stampVideoTimes({ updateRun }, run(), { liveStreamingDetails: { actualStartTime: START } })).toBe(false);
    expect(updateRun).toHaveBeenCalledTimes(1);
  });
});
