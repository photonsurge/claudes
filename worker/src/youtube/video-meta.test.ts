// The end-of-render metadata calls (short-video plan §6.3, §6.8): one
// videos.update for tags, category and privacy that preserves the rest of the
// snippet and status, and the playlist add — metered like every call.

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => ({})) }));
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => ({})) }));

import { addToPlaylist, updateVideoMeta, type YoutubeCtx } from "./client";
import { MemoryQuotaStore, quotaCost, setQuotaStore, spentToday } from "./quota";

const SNIPPET = { title: "Europe round-up", description: "Europe today.", categoryId: "22", tags: ["old"], defaultLanguage: "en" };
const STATUS = { privacyStatus: "unlisted", embeddable: true, license: "youtube", publicStatsViewable: true, selfDeclaredMadeForKids: false };

function ctxWith(item: any = { snippet: SNIPPET, status: STATUS }) {
  const youtube = {
    videos: { list: jest.fn(async () => ({ data: { items: item ? [item] : [] } })), update: jest.fn(async () => ({ data: {} })) },
    playlistItems: { insert: jest.fn(async () => ({ data: {} })) },
  };
  return { ctx: { youtube, accountId: "acc" } as unknown as YoutubeCtx, youtube };
}

beforeEach(() => setQuotaStore(new MemoryQuotaStore()));

describe("updateVideoMeta", () => {
  it("writes tags, category and privacy in ONE videos.update, keeping title, description and status flags", async () => {
    const { ctx, youtube } = ctxWith();
    expect(await updateVideoMeta(ctx, "vid", { tags: ["weather", "europe"], categoryId: "25", privacy: "public" })).toEqual({ changed: true });
    expect(youtube.videos.list).toHaveBeenCalledWith({ part: ["snippet", "status"], id: ["vid"] });
    expect(youtube.videos.update).toHaveBeenCalledTimes(1);
    expect(youtube.videos.update).toHaveBeenCalledWith({
      part: ["snippet", "status"],
      requestBody: {
        id: "vid",
        snippet: { title: "Europe round-up", description: "Europe today.", categoryId: "25", tags: ["weather", "europe"], defaultLanguage: "en" },
        status: { privacyStatus: "public", embeddable: true, license: "youtube", publicStatsViewable: true, selfDeclaredMadeForKids: false },
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(await spentToday("acc")).toBe(quotaCost("videos.list") + quotaCost("videos.update"));
  });

  it("only sends the part that changes, and skips the write when nothing does", async () => {
    const { ctx, youtube } = ctxWith();
    await updateVideoMeta(ctx, "vid", { privacy: "public" });
    expect((youtube.videos.update.mock.calls[0] as any[])[0].part).toEqual(["status"]);

    const { ctx: same, youtube: y2 } = ctxWith();
    expect(await updateVideoMeta(same, "vid", { tags: ["old"], categoryId: "22", privacy: "unlisted" })).toEqual({ changed: false });
    expect(y2.videos.update).not.toHaveBeenCalled();
  });

  it("throws for a video that isn't there", async () => {
    const { ctx } = ctxWith(null);
    await expect(updateVideoMeta(ctx, "gone", { privacy: "public" })).rejects.toThrow(/not found/);
  });
});

describe("addToPlaylist", () => {
  it("inserts the video into the playlist, metered at 50 units", async () => {
    const { ctx, youtube } = ctxWith();
    await addToPlaylist(ctx, "PL1", "vid");
    expect(youtube.playlistItems.insert).toHaveBeenCalledWith({
      part: ["snippet"],
      requestBody: { snippet: { playlistId: "PL1", resourceId: { kind: "youtube#video", videoId: "vid" } } },
    });
    expect(quotaCost("playlistItems.insert")).toBe(50);
    await new Promise((r) => setImmediate(r));
    expect(await spentToday("acc")).toBe(50);
  });
});
