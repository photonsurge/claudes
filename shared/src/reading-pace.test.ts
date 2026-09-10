import {
  clampReadCps,
  crawlSeconds,
  DEFAULT_READ_CPS,
  feedRowMs,
  FEED_ROW_MS_MAX,
  FEED_ROW_MS_MIN,
  readSeconds,
  readWpm,
  READ_CPS_MAX,
  READ_CPS_MIN,
  scrollPxPerSec,
  SCROLL_PX_S_MAX,
  SCROLL_PX_S_MIN,
  SUBTITLE_CPS_ADULT,
} from "./reading-pace";

describe("reading pace", () => {
  it("defaults below the broadcast subtitle ceiling", () => {
    expect(DEFAULT_READ_CPS).toBeLessThan(SUBTITLE_CPS_ADULT);
    expect(readWpm(DEFAULT_READ_CPS)).toBe(150);
  });

  it("clamps anything untrusted into the operator range", () => {
    expect(clampReadCps(12)).toBe(12);
    expect(clampReadCps(0)).toBe(DEFAULT_READ_CPS);
    expect(clampReadCps(-4)).toBe(DEFAULT_READ_CPS);
    expect(clampReadCps("nope")).toBe(DEFAULT_READ_CPS);
    expect(clampReadCps(undefined)).toBe(DEFAULT_READ_CPS);
    expect(clampReadCps(999)).toBe(READ_CPS_MAX);
    expect(clampReadCps(0.2)).toBe(READ_CPS_MIN);
  });

  it("reads N characters in N/pace seconds", () => {
    expect(readSeconds(150, 15)).toBe(10);
    expect(readSeconds(0, 15)).toBe(0);
  });

  it("paces a crawl by its length, with a floor for tiny feeds", () => {
    // A long feed: pure read time, so px/s is the same whatever the length.
    expect(crawlSeconds(1500, 15)).toBe(100);
    expect(crawlSeconds(3000, 15)).toBe(200);
    // A short feed would whip round; the floor holds it.
    expect(crawlSeconds(30, 15)).toBe(24);
    // A slower pace takes longer over the same feed.
    expect(crawlSeconds(1500, 10)).toBe(150);
  });

  it("scrolls dense text slower than sparse text", () => {
    const dense = scrollPxPerSec(400, 1400, 15);
    const sparse = scrollPxPerSec(400, 400, 15);
    expect(dense).toBeLessThan(sparse);
    // 1400 chars over 400px = 3.5 chars/px, so 15 cps ≈ 4.3 px/s.
    expect(dense).toBeCloseTo(4.29, 1);
  });

  it("bounds the scroll speed and copes with unmeasured content", () => {
    expect(scrollPxPerSec(0, 0, 15)).toBeGreaterThanOrEqual(SCROLL_PX_S_MIN);
    expect(scrollPxPerSec(10, 99999, 15)).toBe(SCROLL_PX_S_MIN);
    expect(scrollPxPerSec(9999, 1, 15)).toBe(SCROLL_PX_S_MAX);
  });

  it("holds a marquee row for its own read time, bounded", () => {
    expect(feedRowMs(45, 15)).toBe(3000);
    expect(feedRowMs(90, 15)).toBe(6000);
    expect(feedRowMs(2, 15)).toBe(FEED_ROW_MS_MIN);
    expect(feedRowMs(9000, 15)).toBe(FEED_ROW_MS_MAX);
    // No rows measured yet — the nominal row, not zero.
    expect(feedRowMs(0, 15)).toBe(3000);
  });
});
