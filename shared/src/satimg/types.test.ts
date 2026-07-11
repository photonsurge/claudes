import {
  broadcastSatImgFeeds,
  defaultSatImgFeeds,
  SATIMG_FEEDS,
  type SatImgFeedState,
} from "./types";

describe("broadcastSatImgFeeds", () => {
  const discIds = SATIMG_FEEDS.filter((f) => f.kind === "disc").map((f) => f.id);

  it("forces every regional disc off", () => {
    // Everything on — the worst case an operator/slide could push to /watch.
    const all: Record<string, SatImgFeedState> = Object.fromEntries(
      SATIMG_FEEDS.map((f) => [f.id, { on: true, opacity: 0.9, look: "geocolor" }]),
    );
    const out = broadcastSatImgFeeds(all);
    for (const id of discIds) expect(out[id].on).toBe(false);
  });

  it("leaves the global mosaic and lightning overlay untouched", () => {
    const feeds: Record<string, SatImgFeedState> = {
      global: { on: true, opacity: 0.85 },
      "goes-east": { on: true, opacity: 0.9, look: "ir" },
      lightning: { on: true, opacity: 0.95 },
    };
    const out = broadcastSatImgFeeds(feeds);
    expect(out.global).toEqual({ on: true, opacity: 0.85 });
    expect(out.lightning).toEqual({ on: true, opacity: 0.95 });
    expect(out["goes-east"].on).toBe(false);
    // Non-`on` disc fields are preserved (only `on` is overridden).
    expect(out["goes-east"].opacity).toBe(0.9);
    expect(out["goes-east"].look).toBe("ir");
  });

  it("returns a fresh object without mutating the input", () => {
    const feeds = defaultSatImgFeeds();
    feeds["goes-east"].on = true;
    const out = broadcastSatImgFeeds(feeds);
    expect(out).not.toBe(feeds);
    expect(out["goes-east"]).not.toBe(feeds["goes-east"]);
    expect(feeds["goes-east"].on).toBe(true); // input untouched
    expect(out["goes-east"].on).toBe(false);
  });

  it("is a no-op shape for the default feeds (discs already off)", () => {
    const out = broadcastSatImgFeeds(defaultSatImgFeeds());
    expect(out.global.on).toBe(true);
    for (const id of discIds) expect(out[id].on).toBe(false);
  });

  it("handles undefined input", () => {
    expect(broadcastSatImgFeeds(undefined)).toEqual({});
  });
});
